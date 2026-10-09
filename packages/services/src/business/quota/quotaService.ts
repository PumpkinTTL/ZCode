/* eslint-disable max-lines -- 供应商额度服务的单一装配点：凭证生命周期 + 响应投影 +
   推荐额度视图 + 登录/注册/充值/签到等用户侧动作集中一处，与 quotaClient.ts 的
   max-lines 豁免同一理由（拆文件会让凭证收尾与 401 回落口径散落多处）。 */
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
  projectResetCard,
  projectSubscription,
  projectUsername,
  projectWallet,
} from "./quotaClient.js";
import {
  IProviderQuotaService,
  NIMBUS_AGENT_KEY_CREDENTIAL_KEY,
  NIMBUS_AGENT_KEY_NAME,
  NIMBUS_CLIENT_ID,
  QUOTA_TOKEN_CREDENTIAL_KEY,
  QUOTA_USERNAME_CREDENTIAL_KEY,
  type NimbusDeviceIdentity,
  type NimbusDeviceKeyProvider,
  type QuotaLoginParams,
} from "./quota.js";
import type {
  QuotaCheckinResult,
  QuotaCheckinStatus,
  QuotaModelCatalogEntry,
  QuotaNotice,
  QuotaPasswordResetParams,
  QuotaRechargeOrderCreated,
  QuotaRechargeOrderStatus,
  QuotaRegisterParams,
  QuotaRegisterStatus,
  QuotaResetCard,
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
  /**
   * 设备密钥能力（Ed25519 配对 + 请求签名）。缺省时 ensureApiKey 会明确报错
   * 而不是退化回「占用户名额的普通 key」老路；宿主组合根注入生产实现。
   */
  readonly deviceKeys?: NimbusDeviceKeyProvider;
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

/** 生效中的订阅排前，同级按剩余额度降序。 */
function sortSubscriptions(subs: readonly QuotaSubscription[]): readonly QuotaSubscription[] {
  const weight = (s: QuotaSubscription) => (s.status === "active" ? 0 : 1);
  return [...subs].sort((a, b) => weight(a) - weight(b) || b.remaining - a.remaining);
}

/** key 清单条目 → id（数字或字符串；取不出返回 null）。 */
function keyEntryId(entry: Record<string, unknown>): string | number | null {
  if (typeof entry.id === "number" && Number.isFinite(entry.id)) return entry.id;
  if (typeof entry.id === "string" && entry.id) return entry.id;
  return null;
}

/**
 * key 清单条目 → 前缀（服务端掩码形态 "sk-Ab3d****"，去掉尾部星号用于本地
 * 明文的前缀比对；取不出返回 null = 不校验前缀）。
 */
function keyEntryPrefix(entry: Record<string, unknown>): string | null {
  const raw = typeof entry.key_prefix === "string" ? entry.key_prefix : "";
  const prefix = raw.replace(/\*+$/u, "");
  return prefix || null;
}

/** 从 key 清单里挑「复用目标」：仅认 active；多个 active 按 id 升序取最小（幂等）。 */
function pickActiveAgentKey(
  entries: readonly Record<string, unknown>[],
): Record<string, unknown> | null {
  const actives = entries.filter((entry) => {
    const status = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "";
    return status === "active";
  });
  if (actives.length === 0) return null;
  return actives.sort((a, b) => String(keyEntryId(a)).localeCompare(String(keyEntryId(b))))[0] ?? null;
}

export function createQuotaService(options: CreateQuotaServiceOptions): IProviderQuotaService {
  const baseUrl = options.baseUrl?.trim() || resolveQuotaBaseUrl();
  const client = new QuotaApiClient({ baseUrl, fetchImpl: options.fetchImpl });
  const credentialService = options.credentialService;
  const deviceKeys = options.deviceKeys;

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

  /**
   * 设备配对（幂等）：无 device_id 时注册拿回执并写回身份。撞设备上限时服务端
   * 默认先进先出淘汰最早设备（级联吊销其 agent key）——本次登录照常成功，只留日志。
   */
  async function pairDevice(
    token: string,
    identity: NimbusDeviceIdentity,
  ): Promise<NimbusDeviceIdentity> {
    if (!deviceKeys) throw new QuotaApiError(500, "Nimbus 设备密钥能力未配置（宿主装配缺失）");
    const report = deviceKeys.deviceReport();
    const registration = await client.registerDevice(
      token,
      {
        clientId: NIMBUS_CLIENT_ID,
        publicKeyRawBase64: deviceKeys.publicKeyRawBase64(identity.publicKeyPem),
        name: report.name,
        platform: report.platform,
        appVersion: report.appVersion,
      },
      deviceKeys.createSigner(identity),
    );
    const next: NimbusDeviceIdentity = { ...identity, deviceId: registration.deviceId };
    await deviceKeys.save(next);
    if (registration.evictedDeviceId !== null) {
      // 淘汰事实只留口径不带标识（device_id/key 不落日志，与 Lyra 同纪律）。
      options.logger?.warn("[quota] Nimbus 设备数已达上限，服务端已自动淘汰最早注册的设备");
    }
    return next;
  }

  /**
   * 认领本设备的 agent key（每设备限一把 active）：
   * 有 active 且本地明文前缀对得上 → 复用；明文断链 → 吊销旧 key 重签发；
   * 无 active → 创建（明文仅此一次，立即入凭证库）。409 竞态按服务端回读的
   * existing_key_id 走同一套复用/轮换判定，绝不静默失败。
   */
  async function claimDeviceKey(token: string, identity: NimbusDeviceIdentity): Promise<string> {
    if (!deviceKeys || identity.deviceId === null) {
      throw new QuotaApiError(500, "Nimbus 设备未配对，无法认领调用密钥");
    }
    const sign = deviceKeys.createSigner(identity);
    const listOptions = {
      clientId: NIMBUS_CLIENT_ID,
      deviceId: identity.deviceId,
      sign,
    } as const;
    const localKey = (await credentialService.load(NIMBUS_AGENT_KEY_CREDENTIAL_KEY))?.trim() || null;

    /** 明文与清单条目比对通过 → 写回身份并复用本地明文。 */
    const reuse = async (entry: Record<string, unknown>): Promise<string | null> => {
      const prefix = keyEntryPrefix(entry);
      if (!localKey || (prefix !== null && !localKey.startsWith(prefix))) return null;
      await deviceKeys!.save({ ...identity, keyId: keyEntryId(entry), keyPrefix: prefix });
      return localKey;
    };

    const active = pickActiveAgentKey(await client.listApiKeys(token, listOptions));
    if (active) {
      const reused = await reuse(active);
      if (reused !== null) return reused;
      // 明文断链（重装丢凭证 / key 在别处更换）：吊销本设备旧 key → 重签发。
      const keyId = keyEntryId(active);
      if (keyId === null) {
        throw new QuotaApiError(409, "Nimbus 服务端存在无法识别的 agent key，请联系管理员处理");
      }
      await client.revokeApiKey(token, keyId, sign);
    }

    const claim = await client.createAgentKey(
      token,
      { name: NIMBUS_AGENT_KEY_NAME, clientId: NIMBUS_CLIENT_ID, deviceId: identity.deviceId },
      sign,
    );
    if (claim.created) {
      // 明文仅此一次：先落本机凭证库（保住它是最高优先级），再写回身份。
      await credentialService.save(NIMBUS_AGENT_KEY_CREDENTIAL_KEY, claim.key);
      await deviceKeys.save({ ...identity, keyId: claim.keyId, keyPrefix: null });
      return claim.key;
    }

    // 409 竞态：刷新清单回读既有 key，明文仍可用则复用，否则吊销重试一次。
    const refreshed = await client.listApiKeys(token, listOptions);
    const existing =
      refreshed.find((entry) => String(keyEntryId(entry)) === String(claim.existingKeyId)) ??
      pickActiveAgentKey(refreshed);
    if (existing) {
      const reused = await reuse(existing);
      if (reused !== null) return reused;
      const keyId = keyEntryId(existing);
      if (keyId !== null) {
        await client.revokeApiKey(token, keyId, sign);
        const retry = await client.createAgentKey(
          token,
          { name: NIMBUS_AGENT_KEY_NAME, clientId: NIMBUS_CLIENT_ID, deviceId: identity.deviceId },
          sign,
        );
        if (retry.created) {
          await credentialService.save(NIMBUS_AGENT_KEY_CREDENTIAL_KEY, retry.key);
          await deviceKeys.save({ ...identity, keyId: retry.keyId, keyPrefix: null });
          return retry.key;
        }
      }
    }
    throw new QuotaApiError(409, "Nimbus 设备密钥认领冲突，请重新登录重试");
  }

  /**
   * 换到 token 后的公共收尾（login / register 共用）：落凭证 + 拉一次全量额度。
   * 登录/注册成功但额度接口失败时不回滚凭证（用户已是登录态），先返回降级的
   * 已登录态让 UI 走重试；401 才清凭证回落未登录。
   */
  async function saveSessionAndFetchStatus(
    token: string,
    username: string,
  ): Promise<QuotaStatusResult> {
    await credentialService.save(QUOTA_TOKEN_CREDENTIAL_KEY, token);
    await credentialService.save(QUOTA_USERNAME_CREDENTIAL_KEY, username);
    try {
      return await fetchStatus(token);
    } catch (error) {
      if (isTokenInvalid(error)) {
        await clearCredentials();
        return { loggedIn: false };
      }
      options.logger?.warn("[quota] 登录/注册成功但拉取额度失败", error);
      return {
        loggedIn: true,
        account: {
          username,
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
      return saveSessionAndFetchStatus(token, params.username);
    },

    async register(params: QuotaRegisterParams): Promise<QuotaStatusResult> {
      // 后端注册成功即签发 JWT（注册即登录），落凭证后走与 login 相同的收尾。
      const { token } = await client.register(params);
      return saveSessionAndFetchStatus(token, params.username.trim());
    },

    async registerStatus(signal?: AbortSignal): Promise<QuotaRegisterStatus> {
      return client.registerStatus(signal);
    },

    async sendRegisterCode(email: string, signal?: AbortSignal): Promise<string> {
      return client.sendRegisterCode(email, signal);
    },

    async forgotPassword(email: string, signal?: AbortSignal): Promise<string> {
      return client.forgotPassword(email, signal);
    },

    async resetPassword(params: QuotaPasswordResetParams): Promise<void> {
      await client.resetPassword(params);
    },

    /** 系统公告 + 全站灰状态：公开端点免登录，直接透传（失败由调用方静默降级）。 */
    async getNotice(signal?: AbortSignal): Promise<QuotaNotice> {
      return client.getNotice(signal);
    },

    /** 每日签到状态：JWT 鉴权；功能关闭时后端 403 detail「签到未开启」原样上抛。 */
    async getCheckinStatus(): Promise<QuotaCheckinStatus> {
      const token = await requireToken();
      return client.getCheckinStatus(token);
    },

    /** 每日签到：成功返回本次奖励；重复签到等失败把后端 detail 原样上抛给 UI。 */
    async checkin(): Promise<QuotaCheckinResult> {
      const token = await requireToken();
      return client.checkin(token);
    },

    async createRechargeOrder(amount: number): Promise<QuotaRechargeOrderCreated> {
      // 金额硬限（10-2000 元）在后端 RechargeIn 校验，超限 detail 可直接展示；
      // 服务层透传不重复钳位，避免与后端口径漂移。
      const token = await requireToken();
      return client.createRechargeOrder(token, { amount });
    },

    async getRechargeOrder(orderNo: string): Promise<QuotaRechargeOrderStatus> {
      const token = await requireToken();
      return client.getRechargeOrder(token, orderNo);
    },

    async cancelRechargeOrder(orderNo: string): Promise<void> {
      const token = await requireToken();
      await client.cancelRechargeOrder(token, orderNo);
    },

    async logout(): Promise<void> {
      const token = await readToken();
      if (token) await client.logout(token);
      await clearCredentials();
    },

    /**
     * 确保拿到本设备可用的调用密钥（设备专属 agent key 方案，与 Lyra 同一契约）：
     *
     *   1. 取/生成本机 Ed25519 设备身份（未配对 → registerDevice 拿 device_id；
     *      同公钥重复注册幂等，撞设备上限服务端默认先进先出淘汰最早设备）；
     *   2. 认领 agent key（每 (user, client_id, device) 限一把 active，
     *      **不占用户手建 key 名额**）：有 active 且本地明文可用 → 复用；
     *      明文断链（重装丢凭证/key 在别处更换）→ 吊销本设备旧 key 重签发；
     *      无 active → 创建（明文仅此一次，立即存本机凭证库）；
     *   3. 设备被撤销（403「设备已撤销」）→ 同公钥重注册复活原行，重试一次。
     *
     * 多端登录互不影响：每台设备各自配对、各持一把 key，吊销也只动本设备。
     */
    async ensureApiKey(): Promise<string> {
      const token = await requireToken();
      if (!deviceKeys) {
        throw new QuotaApiError(500, "Nimbus 设备密钥能力未配置（宿主装配缺失）");
      }
      let identity = await deviceKeys.loadOrCreate();
      if (identity.deviceId === null) {
        identity = await pairDevice(token, identity);
      }
      try {
        return await claimDeviceKey(token, identity);
      } catch (error) {
        // 设备与账号失配的两种形态都走「同公钥重注册」自愈，重试一次：
        //   403「设备已撤销」——被控制台撤销/淘汰，同公钥重注册=复活原行；
        //   404「设备不存在」——同机换账号登录（device 行属上一个用户）或行被硬删，
        //     重注册会为当前账号建/复活自己的 device 行（多用户共用一台装机自此可用）。
        if (error instanceof QuotaApiError && (error.status === 403 || error.status === 404)) {
          const revived = await pairDevice(token, { ...identity, deviceId: null });
          return await claimDeviceKey(token, revived);
        }
        throw error;
      }
    },

    /** 本次会话实际生效的 base（供 UI 装配供应商时与额度服务保持同源）。 */
    async getBaseUrl(): Promise<string> {
      return baseUrl;
    },

    /** 我的可用重置卡数量：纯展示数据，未登录/失败一律 0，不抛错不打断面板。 */
    async getResetCardCount(): Promise<number> {
      const token = await readToken();
      if (!token) return 0;
      try {
        return await client.countResetCards(token);
      } catch (error) {
        if (isTokenInvalid(error)) await clearCredentials();
        options.logger?.warn("[quota] 重置卡数量查询失败，按 0 展示", error);
        return 0;
      }
    },

    /** 我的重置卡全量清单（弹窗渲染 + 兑换前的可用性口径）。未登录返回空数组。 */
    async listResetCards(): Promise<readonly QuotaResetCard[]> {
      const token = await requireToken();
      const items = await client.listResetCards(token);
      return items
        .map((item) => projectResetCard(item))
        .filter((card): card is QuotaResetCard => card !== null);
    },

    /** 使用一张重置卡：成功后由 UI 触发额度状态刷新；失败抛服务端 detail。 */
    async redeemResetCard(cardId: number): Promise<void> {
      const token = await requireToken();
      await client.redeemResetCard(token, cardId);
    },

    /** 用调用密钥拉模型目录（/v1/models）：按 id 去重保序，重复 id 保留首个条目。 */
    async getModelCatalog(apiKey: string): Promise<QuotaModelCatalogEntry[]> {
      const entries = await client.listModelCatalog(apiKey);
      const seen = new Set<string>();
      return entries.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
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
