/**
 * 供应商额度服务实现：登录态管理 + 额度聚合。
 *
 * 职责边界：本文件只做「凭证生命周期 + 响应投影 + 推荐额度视图」；
 * HTTP 细节在 quotaClient.ts，对外契约在 quota.ts。
 *
 * 凭证：token / username 存 `ICredentialService`（与反馈服务的 JWT 同一存储），
 * 不落 settings.json，避免随设置同步被复制到别的机器。
 */
import { resolveZCodeRuntimeEnv, type ZCodeRuntimeEnv } from "@zcode/shared";
import type { ICredentialService } from "../../credential/credential.js";
import {
  QuotaApiClient,
  QuotaApiError,
  projectEmailMasked,
  projectSubscription,
  projectUsername,
  projectWallet,
} from "./quotaClient.js";
import {
  IProviderQuotaService,
  QUOTA_TOKEN_CREDENTIAL_KEY,
  QUOTA_USERNAME_CREDENTIAL_KEY,
  type QuotaLoginParams,
} from "./quota.js";
import type {
  QuotaStatus,
  QuotaStatusResult,
  QuotaSubscription,
  QuotaUsageDay,
} from "./quotaTypes.js";

/**
 * 打包（生产）版默认的供应商域名。换供应商时**只改这个常量**（或用 QUOTA_BASE_URL
 * 环境变量覆盖），本业务层的代码与文件名都不用动。
 */
export const DEFAULT_QUOTA_BASE_URL = "https://nimbus.bitlesu.com";

/**
 * 开发（未打包）运行时的本地联调后端：与 Lyra `resolveNimbusBase` / docs/nimbus-device-key.md §10
 * 同一口径（dev 默认 127.0.0.1:8000，环境变量可覆盖，打包版永不命中）。
 */
export const DEV_QUOTA_BASE_URL = "http://127.0.0.1:8000";

/** 显式覆盖 base 的环境变量名（开发/生产都生效）。 */
export const QUOTA_BASE_URL_ENV_KEY = "QUOTA_BASE_URL";

/** 登录后自动创建的调用密钥名（服务端 key 列表只回前缀，固定名字便于在门户里识别）。 */
export const QUOTA_API_KEY_NAME = "Polaris";

export interface ResolveQuotaBaseUrlOptions {
  readonly env?: Record<string, string | undefined>;
  /**
   * 运行环境判据（"未打包" = development）。缺省从 `env.ZCODE_RUNTIME_ENV` 读：
   * desktop main 只对未打包实例注入 `development`（见 desktopRuntimeEnv.ts 的
   * desktopRuntimeEnv / buildHostProcessEnv），**不能**用 ZCODE_ENV —— dev:desktop
   * 跑的就是 ZCODE_ENV=production 但未打包的形态。
   */
  readonly runtimeEnv?: ZCodeRuntimeEnv;
}

/**
 * base URL 的唯一解析出口（host 装配与「告知 UI 实际 base」共用同一份逻辑）：
 * 1. `QUOTA_BASE_URL` 显式覆盖优先（开发/生产都生效）——非法值直接抛错，
 *    静默回退会把联调流量打进生产库，宁可启动即失败；
 * 2. 未打包（ZCODE_RUNTIME_ENV=development）→ 本地 127.0.0.1:8000；
 * 3. 其余（打包生产 / CLI / 测试）→ nimbus.bitlesu.com。
 */
export function resolveQuotaBaseUrl(options: ResolveQuotaBaseUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env[QUOTA_BASE_URL_ENV_KEY]?.trim();
  if (override) {
    if (!/^https?:\/\//iu.test(override)) {
      throw new Error(
        `环境变量 ${QUOTA_BASE_URL_ENV_KEY} 不合法：${override.slice(0, 200)}（应为 http(s):// 开头的完整地址）`,
      );
    }
    return override.replace(/\/+$/u, "");
  }
  const runtimeEnv = options.runtimeEnv ?? resolveZCodeRuntimeEnv(env);
  return runtimeEnv === "development" ? DEV_QUOTA_BASE_URL : DEFAULT_QUOTA_BASE_URL;
}

export interface CreateQuotaServiceOptions {
  readonly credentialService: ICredentialService;
  readonly logger?: {
    warn: (...args: unknown[]) => void;
  };
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/** 文档 5.2 的推荐额度视图：有生效套餐报套餐，无套餐报钱包。 */
function computeQuotaView(
  wallet: QuotaStatus["account"]["wallet"],
  subscriptions: readonly QuotaSubscription[],
): QuotaStatus["quota"] {
  const active = subscriptions.filter((s) => s.status === "active" || s.status === "used_up");
  const first = active[0];
  if (!first) {
    return { kind: "wallet", left: wallet.available, total: null, notActivated: false };
  }
  if (first.kind === "per_call") {
    return {
      kind: "per_call",
      left: first.remainingCalls ?? first.remaining,
      total: first.totalCalls,
      notActivated: first.expiresAt === 0,
    };
  }
  return {
    kind: "credits",
    left: first.remaining,
    total: first.creditsTotal,
    notActivated: false,
  };
}

/**
 * 从密钥列表条目里取出可用的密钥值。
 *
 * 不限定字段名与 `sk-` 前缀：不同部署的密钥列表字段并不统一（`key` / `token` / `secret` /
 * `api_key`），也不保证都以 `sk-` 开头。过去只认 `key` + `sk-` 前缀，匹配不到就转去创建，
 * 于是每次登录都会新建一把密钥。
 */
function readApiKeyValue(entry: Record<string, unknown>): string {
  for (const field of ["key", "token", "api_key", "apiKey", "secret"]) {
    const value = entry[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

/** 生效中的订阅排前，同级按剩余额度降序。 */
function sortSubscriptions(subs: readonly QuotaSubscription[]): readonly QuotaSubscription[] {
  const weight = (s: QuotaSubscription) => (s.status === "active" ? 0 : 1);
  return [...subs].sort((a, b) => weight(a) - weight(b) || b.remaining - a.remaining);
}

export function createQuotaService(options: CreateQuotaServiceOptions): IProviderQuotaService {
  const baseUrl = options.baseUrl?.trim() || resolveQuotaBaseUrl();
  const client = new QuotaApiClient({ baseUrl, fetchImpl: options.fetchImpl });
  const credentialService = options.credentialService;

  async function readToken(): Promise<string | null> {
    const token = await credentialService.load(QUOTA_TOKEN_CREDENTIAL_KEY);
    return token?.trim() || null;
  }

  async function requireToken(): Promise<string> {
    const token = await readToken();
    if (!token) throw new QuotaApiError(401, "请先登录供应商账号");
    return token;
  }

  async function clearCredentials(): Promise<void> {
    await credentialService.delete(QUOTA_TOKEN_CREDENTIAL_KEY);
    await credentialService.delete(QUOTA_USERNAME_CREDENTIAL_KEY);
  }

  /** 401 = token 过期/已登出：清凭证并回落到未登录态，不向 UI 抛错。 */
  function isTokenInvalid(error: unknown): boolean {
    return error instanceof QuotaApiError && error.status === 401;
  }

  async function fetchStatus(token: string): Promise<QuotaStatus> {
    const [me, plans] = await Promise.all([client.getMe(token), client.getPlans(token)]);

    const wallet = projectWallet(me);
    const rawSubs = Array.isArray(plans.subscriptions) ? plans.subscriptions : [];
    // 只保留生效中的订阅；expired/cancelled 对"还能用多少"没有信息量。
    const subscriptions = sortSubscriptions(
      rawSubs
        .map((raw) => projectSubscription(raw))
        .filter(
          (sub): sub is QuotaSubscription =>
            sub !== null && (sub.status === "active" || sub.status === "used_up"),
        ),
    );

    const quota = computeQuotaView(wallet, subscriptions);
    return {
      loggedIn: true,
      account: {
        username: projectUsername(me),
        emailMasked: projectEmailMasked(me),
        wallet,
      },
      subscriptions,
      quota,
    };
  }

  return {
    async getStatus(): Promise<QuotaStatusResult> {
      const token = await readToken();
      if (!token) return { loggedIn: false };
      try {
        return await fetchStatus(token);
      } catch (error) {
        if (isTokenInvalid(error)) {
          await clearCredentials();
          return { loggedIn: false };
        }
        throw error;
      }
    },

    async login(params: QuotaLoginParams): Promise<QuotaStatusResult> {
      const { token } = await client.login(params.username, params.password);
      await credentialService.save(QUOTA_TOKEN_CREDENTIAL_KEY, token);
      await credentialService.save(QUOTA_USERNAME_CREDENTIAL_KEY, params.username);
      try {
        return await fetchStatus(token);
      } catch (error) {
        // 登录成功但额度接口失败：凭证已存，先返回已登录态，让 UI 走重试。
        if (isTokenInvalid(error)) {
          await clearCredentials();
          return { loggedIn: false };
        }
        options.logger?.warn("[quota] login 成功但拉取额度失败", error);
        return {
          loggedIn: true,
          account: {
            username: params.username,
            emailMasked: null,
            wallet: {
              available: 0,
              balance: 0,
              creditsPerYuan: 0,
              todaySpend: 0,
              monthSpend: 0,
              lowBalance: false,
              rechargeEnabled: true,
            },
          },
          subscriptions: [],
          quota: { kind: "wallet", left: 0, total: null, notActivated: false },
        };
      }
    },

    async logout(): Promise<void> {
      const token = await readToken();
      if (token) await client.logout(token);
      await clearCredentials();
    },

    /**
     * 取一个可用的调用密钥：优先复用账号里已有的密钥；**一把都没有时自动创建**
     * （POST /api/v1/user/keys，JWT 鉴权，名字固定 QUOTA_API_KEY_NAME）。
     *
     * 为什么从「只读不建」改为「没有就建」：登录的终点是「可用」，不是「登录页放行」。
     * 账号里没有 sk- 密钥时，旧的只读实现只能抛错，用户看到的是「登录成功但什么反应都没有」；
     * 这与 Lyra 的自动认领（claimAgentKey：有则复用、无则创建）是同一精神。
     * 名额上限 / 限流由服务端裁决（400/429 的 detail 直接透出），这里不预先拒绝。
     *
     * 范围决策：**不引入** Lyra 的设备身份流程（Ed25519 配对 + via='agent' 设备绑定密钥）——
     * 那是另一期工作；本期只创建一把普通用户密钥，不占 agent key 的设备名额。
     * 服务端密钥列表只回 key_prefix（掩码），明文仅创建响应返回一次：明文由调用方
     * （provisionNimbusProvider）写进供应商配置持久化；下次登录若列表里读不到明文、
     * 供应商配置又不可用，会自动再建一把（名字固定，便于在门户识别与清理）。
     */
    async ensureApiKey(): Promise<string> {
      const token = await requireToken();
      const keys = await client.listApiKeys(token);
      const existing = keys.map(readApiKeyValue).find((key) => key.length > 0);
      if (existing) return existing;
      const created = await client.createApiKey(token, QUOTA_API_KEY_NAME);
      return created.key;
    },

    /** 本次会话实际生效的 base（供 UI 装配供应商时与额度服务保持同源）。 */
    async getBaseUrl(): Promise<string> {
      return baseUrl;
    },

    /** 用调用密钥拉模型目录（OpenAI 兼容 /v1/models），返回去重后的模型 id。 */
    async getModelIds(apiKey: string): Promise<string[]> {
      const ids = await client.listModelIds(apiKey);
      return [...new Set(ids)];
    },

    async getUsageDaily(days: number): Promise<readonly QuotaUsageDay[]> {
      const token = await readToken();
      if (!token) return [];
      try {
        const raw = await client.getUsageDaily(token, days);
        return raw.map((item) => ({
          date: typeof item.date === "string" ? item.date : "",
          requests: typeof item.requests === "number" ? item.requests : null,
          charged: typeof item.charged === "number" ? item.charged : null,
          cacheHitRate: typeof item.cache_hit_rate === "number" ? item.cache_hit_rate : null,
        }));
      } catch (error) {
        if (isTokenInvalid(error)) {
          await clearCredentials();
          return [];
        }
        throw error;
      }
    },
  } satisfies IProviderQuotaService;
}
