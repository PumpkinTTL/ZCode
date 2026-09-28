/**
 * 供应商额度服务实现：登录态管理 + 额度聚合。
 *
 * 职责边界：本文件只做「凭证生命周期 + 响应投影 + 推荐额度视图」；
 * HTTP 细节在 quotaClient.ts，对外契约在 quota.ts。
 *
 * 凭证：token / username 存 `ICredentialService`（与反馈服务的 JWT 同一存储），
 * 不落 settings.json，避免随设置同步被复制到别的机器。
 */
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
 * 当前供应商的部署地址。换供应商时**只改这个常量**（或用 QUOTA_BASE_URL 环境变量覆盖），
 * 本业务层的代码与文件名都不用动。
 */
export const DEFAULT_QUOTA_BASE_URL = "https://nimbus.bitlesu.com";

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
  const active = subscriptions.filter(
    (s) => s.status === "active" || s.status === "used_up",
  );
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

/** 生效中的订阅排前，同级按剩余额度降序。 */
function sortSubscriptions(
  subs: readonly QuotaSubscription[],
): readonly QuotaSubscription[] {
  const weight = (s: QuotaSubscription) => (s.status === "active" ? 0 : 1);
  return [...subs].sort((a, b) => weight(a) - weight(b) || b.remaining - a.remaining);
}

export function createQuotaService(options: CreateQuotaServiceOptions): IProviderQuotaService {
  const baseUrl = options.baseUrl?.trim() || DEFAULT_QUOTA_BASE_URL;
  const client = new QuotaApiClient({ baseUrl, fetchImpl: options.fetchImpl });
  const credentialService = options.credentialService;

  async function readToken(): Promise<string | null> {
    const token = await credentialService.load(QUOTA_TOKEN_CREDENTIAL_KEY);
    return token?.trim() || null;
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
