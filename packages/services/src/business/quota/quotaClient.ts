/* eslint-disable max-lines -- 同一供应商的用户侧 HTTP 契约集中一处（登录/额度/套餐/密钥/设备/重置卡），
   拆文件会让 409/404 冲突契约与签名头注入口径散落多处；先集中维护协议边界。 */
/**
 * 供应商额度 HTTP 客户端（纯函数，无状态；供应商差异只在 baseUrl 配置）。
 *
 * 协议要点（当前供应商的调用文档）：
 * - 登录路径是 /api/v1/user/login（不是 /api/v1/login），用户侧路由统一挂 /user 前缀
 * - token 只放 Authorization Header，不放 URL query（会进访问日志）
 * - 错误响应统一形如 { detail: string }，detail 是给最终用户看的中文，可直接展示
 * - 401 = token 过期/登出 → 需重新登录；429 → 读 Retry-After
 * - 密钥「有则复用、无则创建」：登录后先用账号已有密钥；一把都没有时 createApiKey
 *   自动建一把（登录即可用，与 Lyra claimAgentKey 同一精神）。
 */

const LOGIN_PATH = "/api/v1/user/login";
const LOGOUT_PATH = "/api/v1/user/logout";
const ME_PATH = "/api/v1/user/me";
const PLANS_PATH = "/api/v1/user/plans";
const USAGE_DAILY_PATH = "/api/v1/user/usage/daily";
const KEYS_PATH = "/api/v1/user/keys";
const RESET_CARDS_PATH = "/api/v1/user/reset-cards";
const DEVICES_REGISTER_PATH = "/api/v1/user/devices/register";
const MODELS_PATH = "/v1/models";
// 注册 / 忘记密码（公开端点，未登录可用；契约见 cbcn-cloud app/api/v1/user.py、passwd.py）
const REGISTER_STATUS_PATH = "/api/v1/user/register-status";
const REGISTER_PATH = "/api/v1/user/register";
const REGISTER_SEND_CODE_PATH = "/api/v1/user/register/send-code";
const PASSWORD_FORGOT_PATH = "/api/v1/user/password/forgot";
const PASSWORD_RESET_PATH = "/api/v1/user/password/reset";
// 充值（JWT 鉴权；契约见 cbcn-cloud app/api/v1/alipay.py）
const RECHARGE_PATH = "/api/v1/alipay/recharge";
const ALIPAY_ORDERS_PATH = "/api/v1/alipay/orders";
// 系统公告 + 全站灰纪念模式（公开端点，免登录——登录页也要能看；契约 cbcn-cloud user.py）
const NOTICE_PATH = "/api/v1/user/notice";
// 每日签到（JWT 鉴权；契约见 cbcn-cloud app/api/v1/perks.py）
const CHECKIN_PATH = "/api/v1/user/checkin";
const CHECKIN_STATUS_PATH = "/api/v1/user/checkin/status";

/**
 * 一次待签名请求的描述（设备身份模块的 Ed25519 签名契约配套；签名串只取
 * path 不含 query）。签名器由宿主注入，本文件不感知 node:crypto。
 */
export interface QuotaSignDescriptor {
  readonly method: string;
  readonly pathWithQuery: string;
  readonly body: string | null;
}

export type QuotaRequestSigner = (descriptor: QuotaSignDescriptor) => Record<string, string>;

/** 非 2xx 时抛出；message 为可直接展示的中文文案。 */
export class QuotaApiError extends Error {
  readonly status: number;
  /** 服务端 detail 文案（可直接展示给用户） */
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `额度服务请求失败（HTTP ${status}）`);
    this.name = "QuotaApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface QuotaApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

/** 容错读法：文档明确"看不到的字段不要猜"，缺键返回 undefined。 */
function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberOr(value: unknown, fallback: number): number {
  return readNumber(value) ?? fallback;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** 从错误响应里提取可直接展示的中文 detail；提取不到就用 HTTP 状态兜底。 */
async function toApiError(response: Response): Promise<QuotaApiError> {
  const body = (await parseJson(response)) as { detail?: unknown } | null;
  const detail =
    typeof body?.detail === "string" ? body.detail : `额度服务请求失败（HTTP ${response.status}）`;
  return new QuotaApiError(response.status, detail);
}

export class QuotaApiClient {
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: QuotaApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  /** 登录换 JWT。失败抛 QuotaApiError（detail 可直接展示，如「用户名或密码错误」）。 */
  async login(
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<{ token: string }> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${LOGIN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) throw new QuotaApiError(response.status, "登录响应缺少 token");
    return { token };
  }

  /** 登出（服务端拉黑 token）。失败静默——登出本身不该阻塞 UI。 */
  async logout(token: string): Promise<void> {
    try {
      await this.#fetchImpl(`${this.#baseUrl}${LOGOUT_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* 忽略：本地凭证一定会被清除，服务端拉黑失败只影响该 token 的可用性 */
    }
  }

  /**
   * 列出调用密钥。可按客户端 + 设备过滤（agent key 认领用）。
   *
   * 形状容错：当前后端返回 `{ items: [...] }`（旧实现只认数组/keys/data，
   * 对 items 恒解析成空 → 每次登录都误判「没有密钥」；本修复同时是
   * agent key 认领的前置条件）。
   */
  async listApiKeys(
    token: string,
    options?: {
      signal?: AbortSignal;
      clientId?: string;
      deviceId?: string;
      sign?: QuotaRequestSigner;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const query = new URLSearchParams();
    if (options?.clientId) query.set("client_id", options.clientId);
    if (options?.deviceId) query.set("device_id", options.deviceId);
    const pathWithQuery = query.size > 0 ? `${KEYS_PATH}?${query.toString()}` : KEYS_PATH;
    const signed = options?.sign?.({ method: "GET", pathWithQuery, body: null }) ?? {};
    const response = await this.#fetchImpl(`${this.#baseUrl}${pathWithQuery}`, {
      headers: { Authorization: `Bearer ${token}`, ...signed },
      signal: options?.signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as unknown;
    if (Array.isArray(body)) return body;
    for (const field of ["items", "keys", "data"] as const) {
      const list = (body as Record<string, unknown>)?.[field];
      if (Array.isArray(list)) return list as Array<Record<string, unknown>>;
    }
    return [];
  }

  /**
   * 创建一把普通调用密钥（POST /api/v1/user/keys，JWT 鉴权）。
   *
   * 服务端契约（cbcn-cloud app/api/v1/user.py create_key）：body `{ name }`
   * （1..64 字符，缺省 "default"），成功返回 `{ key: "sk-…", id, name }`，
   * **明文仅此一次**（列表接口只回掩码 key_prefix）。刻意不传 via/client_id/device_id ——
   * 设备绑定密钥（agent key）是 Lyra 的设备身份流程，不在本期范围。
   */
  async createApiKey(token: string, name: string, signal?: AbortSignal): Promise<{ key: string }> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { key?: unknown } | null;
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    if (!key) throw new QuotaApiError(response.status, "创建调用密钥响应缺少 key");
    return { key };
  }

  /**
   * 注册设备（POST /api/v1/user/devices/register，JWT + 设备签名双鉴权）。
   *
   * 服务端契约：client_id 必须是 apps 表已有行；public_key 为 base64 裸 32 字节；
   * 同 (user, client_id, public_key) 重复注册幂等返回既有行；撤销过的同公钥重注册
   * = 复活原行。成功回执兼容 {id} / {device_id} / {deviceId} 三种形态；撞设备上限
   * 默认 evict_oldest（自动淘汰最早设备并在回执带 evicted_device_id）。
   */
  async registerDevice(
    token: string,
    input: {
      clientId: string;
      publicKeyRawBase64: string;
      name: string;
      platform: string;
      appVersion: string;
    },
    sign?: QuotaRequestSigner,
    signal?: AbortSignal,
  ): Promise<{ deviceId: string; evictedDeviceId: string | null }> {
    const body = JSON.stringify({
      client_id: input.clientId,
      public_key: input.publicKeyRawBase64,
      name: input.name,
      platform: input.platform,
      app_version: input.appVersion,
    });
    const signed = sign?.({ method: "POST", pathWithQuery: DEVICES_REGISTER_PATH, body }) ?? {};
    const response = await this.#fetchImpl(`${this.#baseUrl}${DEVICES_REGISTER_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...signed,
      },
      body,
      signal,
    });
    if (!response.ok && response.status !== 409) throw await toApiError(response);
    const parsed = (await parseJson(response)) as Record<string, unknown> | null;
    const levels: Array<Record<string, unknown> | null> = [parsed];
    const detail = parsed?.detail;
    if (typeof detail === "object" && detail !== null) levels.push(detail as Record<string, unknown>);
    for (const level of levels) {
      const raw =
        level?.device_id ?? level?.deviceId ?? (typeof level?.id === "number" ? level.id : undefined);
      const deviceId = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : null;
      if (deviceId) {
        const evictedRaw = levels.flatMap((l) =>
          l ? [l.evicted_device_id ?? l.evictedDeviceId] : [],
        )[0];
        const evictedDeviceId =
          typeof evictedRaw === "number"
            ? String(evictedRaw)
            : typeof evictedRaw === "string" && evictedRaw
              ? evictedRaw
              : null;
        return { deviceId, evictedDeviceId };
      }
    }
    throw new QuotaApiError(response.status, "设备注册响应缺少 device_id，请稍后重试");
  }

  /**
   * 认领设备专属 agent key（每 (user, client_id, device) 限一把 active）：
   * POST /api/v1/user/keys + `via='agent'` 三件套，**不占用户手建 key 名额**。
   *
   * 服务端契约：成功返回 `{ key, id }`（明文仅此一次）；该设备已有 active 时 409，
   * detail 里带 existing_key_id / key_prefix（明文不可再取，靠本地延续或轮换）。
   * 设备被撤销时 403（detail「设备已撤销」→ 调用方重新注册设备）。
   */
  async createAgentKey(
    token: string,
    input: { name: string; clientId: string; deviceId: string },
    sign?: QuotaRequestSigner,
    signal?: AbortSignal,
  ): Promise<
    | { created: true; key: string; keyId: number | string | null }
    | { created: false; existingKeyId: number | string | null; keyPrefix: string | null }
  > {
    const body = JSON.stringify({
      name: input.name,
      via: "agent",
      client_id: input.clientId,
      device_id: Number(input.deviceId),
    });
    const signed = sign?.({ method: "POST", pathWithQuery: KEYS_PATH, body }) ?? {};
    const response = await this.#fetchImpl(`${this.#baseUrl}${KEYS_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...signed,
      },
      body,
      signal,
    });
    if (response.status === 409) {
      const parsed = (await parseJson(response)) as Record<string, unknown> | null;
      const detail = parsed?.detail;
      const level =
        typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : parsed;
      const existingKeyId =
        (typeof level?.existing_key_id === "number" ? level.existing_key_id : undefined) ??
        (typeof level?.existing_key_id === "string" && level.existing_key_id
          ? level.existing_key_id
          : null);
      const keyPrefix =
        typeof level?.key_prefix === "string" && level.key_prefix ? level.key_prefix : null;
      return { created: false, existingKeyId, keyPrefix };
    }
    if (!response.ok) throw await toApiError(response);
    const parsed = (await parseJson(response)) as Record<string, unknown> | null;
    const key = typeof parsed?.key === "string" ? parsed.key.trim() : "";
    if (!key) throw new QuotaApiError(response.status, "agent key 创建响应缺少明文 key");
    const keyId =
      typeof parsed?.id === "number"
        ? parsed.id
        : typeof parsed?.id === "string" && parsed.id
          ? parsed.id
          : null;
    return { created: true, key, keyId };
  }

  /**
   * 吊销一把密钥（DELETE /api/v1/user/keys/{id}，软删语义）。用于 agent key
   * 明文断链时的自动轮换——只动本设备这一把，多端其他设备不受影响。
   * 404 = 已被吊销/不存在，幂等成功。
   */
  async revokeApiKey(
    token: string,
    keyId: number | string,
    sign?: QuotaRequestSigner,
    signal?: AbortSignal,
  ): Promise<void> {
    const pathWithQuery = `${KEYS_PATH}/${encodeURIComponent(String(keyId))}`;
    const signed = sign?.({ method: "DELETE", pathWithQuery, body: null }) ?? {};
    const response = await this.#fetchImpl(`${this.#baseUrl}${pathWithQuery}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, ...signed },
      signal,
    });
    if (!response.ok && response.status !== 404) throw await toApiError(response);
  }

  /**
   * 模型目录（GET /v1/models；组合条目带展示元数据 multiplier/tags/promo）。
   * 展示字段一律容错读法：服务端未配置/脏值就当没有，不猜、不拦整个目录。
   */
  async listModelCatalog(apiKey: string, signal?: AbortSignal): Promise<QuotaModelCatalogEntry[]> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${MODELS_PATH}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { data?: unknown } | null;
    return projectModelCatalogEntries(body?.data);
  }

  /**
   * 我的重置卡（GET /api/v1/user/reset-cards）：已发放绑定本账号、未使用的
   * 用量重置卡（5h / 周 / 周期窗口）。返回清单条数（面板礼物徽章的数量口径）。
   */
  async countResetCards(token: string, signal?: AbortSignal): Promise<number> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${RESET_CARDS_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as unknown;
    const items =
      typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
        ? ((body as { items: unknown[] }).items as unknown[])
        : [];
    return items.length;
  }

  /** 我的重置卡全量清单（含窗口/可用性预检），供「可重置额度」弹窗渲染。 */
  async listResetCards(
    token: string,
    signal?: AbortSignal,
  ): Promise<Array<Record<string, unknown>>> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${RESET_CARDS_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as unknown;
    const items =
      typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
        ? ((body as { items: unknown[] }).items as Array<Record<string, unknown>>)
        : [];
    return items;
  }

  /**
   * 使用一张重置卡（POST /api/v1/user/reset-cards/{id}/redeem）。
   * 失败抛 QuotaApiError（detail 为可直接展示的中文：冷却中/达日限/无套餐/过期等）。
   */
  async redeemResetCard(token: string, cardId: number, signal?: AbortSignal): Promise<void> {
    const response = await this.#fetchImpl(
      `${this.#baseUrl}${RESET_CARDS_PATH}/${encodeURIComponent(String(cardId))}/redeem`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );
    if (!response.ok) throw await toApiError(response);
  }

  /**
   * 系统公告 + 全站灰纪念模式（GET /api/v1/user/notice，公开端点免登录）。
   * 登录页与已登录主界面共用；grayscale.active 由后端按当前时间算好，前端拿到
   * true 直接挂灰阶，不做任何时区/时间窗解析。失败抛 QuotaApiError（调用方静默降级）。
   */
  async getNotice(signal?: AbortSignal): Promise<QuotaNotice> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${NOTICE_PATH}`, { signal });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    const rawGrayscale =
      typeof body?.grayscale === "object" && body?.grayscale !== null
        ? (body.grayscale as Record<string, unknown>)
        : null;
    return {
      enabled: body?.enabled === true,
      content: readString(body?.content),
      grayscale: {
        enabled: rawGrayscale?.enabled === true,
        start: readString(rawGrayscale?.start),
        end: readString(rawGrayscale?.end),
        active: rawGrayscale?.active === true,
      },
    };
  }

  /**
   * 每日签到状态（GET /api/v1/user/checkin/status，JWT 鉴权）。功能关闭抛
   * QuotaApiError(403)「签到未开启」，调用方据此整体隐藏签到卡。
   */
  async getCheckinStatus(token: string, signal?: AbortSignal): Promise<QuotaCheckinStatus> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${CHECKIN_STATUS_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    return {
      checkedInToday: body?.checked_in_today === true,
      streak: readNumberOr(body?.streak, 0),
      base: readNumberOr(body?.base, 0),
      streakBonus: readNumberOr(body?.streak_bonus, 0),
      tomorrowCredits: readNumberOr(body?.tomorrow_credits, 0),
    };
  }

  /**
   * 每日签到（POST /api/v1/user/checkin，JWT 鉴权）。成功返回本次入账积分与
   * 连签天数；失败抛 QuotaApiError，detail 为可直接展示的中文
   * （409「今日已签到」/ 403「签到未开启」「请先在控制台「绑定邮箱」…」）。
   */
  async checkin(token: string, signal?: AbortSignal): Promise<QuotaCheckinResult> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${CHECKIN_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    const credits = readNumber(body?.credits);
    if (credits === null) {
      throw new QuotaApiError(response.status, "签到响应缺少奖励积分");
    }
    return {
      credits,
      streak: readNumberOr(body?.streak, 0),
      tomorrowCredits: readNumberOr(body?.tomorrow_credits, 0),
    };
  }

  async getMe(token: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${ME_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    return (await parseJson(response)) as Record<string, unknown>;
  }

  async getPlans(token: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${PLANS_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    return (await parseJson(response)) as Record<string, unknown>;
  }

  async getUsageDaily(
    token: string,
    days: number,
    signal?: AbortSignal,
  ): Promise<Array<Record<string, unknown>>> {
    const clamped = Math.min(90, Math.max(1, Math.trunc(days)));
    const response = await this.#fetchImpl(`${this.#baseUrl}${USAGE_DAILY_PATH}?days=${clamped}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { items?: unknown } | null;
    return Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : [];
  }

  // ============ 注册 / 忘记密码（公开端点，未登录可用；契约 cbcn-cloud user.py / passwd.py） ============

  /**
   * 注册开关预检（GET /api/v1/user/register-status，公开端点）。
   * 登录页据此决定是否渲染注册入口、注册表单是否带「邮箱 + 验证码」必填组——
   * 开关由服务端下发，前端不硬编码。
   */
  async registerStatus(signal?: AbortSignal): Promise<QuotaRegisterStatus> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${REGISTER_STATUS_PATH}`, { signal });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    return {
      // 开关键缺失按开放兜底（与后端 is_feature_enabled 缺行默认 True 同口径）；
      // 真正的硬闸在 POST /register，预检只是体验层。
      registerEnabled: body?.register_enabled !== false,
      emailRequired: body?.email_required === true,
    };
  }

  /**
   * 注册（POST /api/v1/user/register，公开端点）。后端注册成功即签发 JWT
   * （响应 { token, id, role, username }），无需再走一次登录；失败抛
   * QuotaApiError（detail 为可直接展示的中文：用户名/密码校验、邮箱占用、限流等）。
   */
  async register(input: QuotaRegisterParams, signal?: AbortSignal): Promise<{ token: string }> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${REGISTER_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        // 后端对空值容忍（invite_code 无效静默忽略；开关关闭时 email 一律忽略），
        // 空串归一为 undefined，避免把「填了空白」当成「填了值」。
        invite_code: input.inviteCode?.trim() || undefined,
        email: input.email?.trim() || undefined,
        email_code: input.emailCode?.trim() || undefined,
      }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) throw new QuotaApiError(response.status, "注册响应缺少 token");
    return { token };
  }

  /** 注册邮箱验证码（POST /api/v1/user/register/send-code，公开端点）。返回服务端提示文案。 */
  async sendRegisterCode(email: string, signal?: AbortSignal): Promise<string> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${REGISTER_SEND_CODE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { message?: unknown } | null;
    return readString(body?.message);
  }

  /**
   * 申请密码重置（POST /api/v1/user/password/forgot，公开端点）。
   * 后端防枚举：无论邮箱是否存在一律 200 同一句文案，message 可直接展示。
   */
  async forgotPassword(email: string, signal?: AbortSignal): Promise<string> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${PASSWORD_FORGOT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { message?: unknown } | null;
    return readString(body?.message);
  }

  /** 重置密码（POST /api/v1/user/password/reset，公开端点）。失败抛 detail（码错/锁定/弱口令）。 */
  async resetPassword(input: QuotaPasswordResetParams, signal?: AbortSignal): Promise<void> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${PASSWORD_RESET_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email.trim(),
        code: input.code.trim(),
        new_password: input.newPassword,
      }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
  }

  // ============ 充值（JWT 鉴权；契约 cbcn-cloud alipay.py） ============

  /**
   * 创建充值订单（POST /api/v1/alipay/recharge）。金额单位为元，后端硬限 10-2000；
   * 返回支付宝当面付二维码 URL（qr_code）——桌面端用系统外链打开即可唤起支付宝。
   * 失败抛 QuotaApiError（403=充值已关闭 / 429=下单限流 / 502=支付宝下单失败）。
   */
  async createRechargeOrder(
    token: string,
    input: { amount: number; discountCode?: string },
    signal?: AbortSignal,
  ): Promise<QuotaRechargeOrderCreated> {
    const response = await this.#fetchImpl(`${this.#baseUrl}${RECHARGE_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amount,
        ...(input.discountCode && input.discountCode.trim()
          ? { discount_code: input.discountCode.trim() }
          : {}),
      }),
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    const orderNo = readString(body?.order_no);
    const qrCode = readString(body?.qr_code);
    if (!orderNo || !qrCode) {
      throw new QuotaApiError(response.status, "充值下单响应缺少订单号或支付码");
    }
    return {
      orderNo,
      qrCode,
      amount: readNumberOr(body?.amount, input.amount),
      payAmount: readNumberOr(body?.pay_amount, input.amount),
      credits: readNumberOr(body?.credits, 0),
      creditsPerYuan: readNumberOr(body?.credits_per_yuan, 0),
    };
  }

  /**
   * 查询充值订单状态（GET /api/v1/alipay/orders/{order_no}）。pending 单后端会
   * 主动查支付宝并对超 15 分钟的单终态化；status ∈ pending | paid | closed。
   * 后端对同一订单有 3 秒节流（60 次/分上限），前端轮询间隔取 3 秒正好贴住节流窗口。
   */
  async getRechargeOrder(
    token: string,
    orderNo: string,
    signal?: AbortSignal,
  ): Promise<QuotaRechargeOrderStatus> {
    const pathWithQuery = `${ALIPAY_ORDERS_PATH}/${encodeURIComponent(orderNo)}`;
    const response = await this.#fetchImpl(`${this.#baseUrl}${pathWithQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as Record<string, unknown> | null;
    return {
      status: readString(body?.status) || "pending",
      payAmount: readNumberOr(body?.pay_amount, 0),
      credits: readNumberOr(body?.credits, 0),
      payUrl: readString(body?.pay_url) || null,
      paidAt: normalizeEpochMs(readNumber(body?.paid_at) ?? 0),
    };
  }

  /**
   * 取消待支付订单（POST /api/v1/alipay/orders/{order_no}/cancel）。
   * 后端先关支付宝交易再关本地单；非 pending 单 400（状态不允许取消）。
   */
  async cancelRechargeOrder(token: string, orderNo: string, signal?: AbortSignal): Promise<void> {
    const pathWithQuery = `${ALIPAY_ORDERS_PATH}/${encodeURIComponent(orderNo)}/cancel`;
    const response = await this.#fetchImpl(`${this.#baseUrl}${pathWithQuery}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await toApiError(response);
  }
}

// ============ 响应 → 领域类型的投影（容错读法，字段名是当前供应商的口径） ============

export function projectWallet(me: Record<string, unknown>) {
  return {
    available: readNumberOr(me.available, 0),
    balance: readNumberOr(me.balance, 0),
    creditsPerYuan: readNumberOr(me.credits_per_yuan, 0),
    todaySpend: readNumberOr(me.today_spend, 0),
    monthSpend: readNumberOr(me.month_spend, 0),
    lowBalance: me.low_balance === true,
    rechargeEnabled: me.recharge_enabled !== false,
  };
}

export function projectUsername(me: Record<string, unknown>): string {
  const nickname = readString(me.nickname).trim();
  if (nickname) return nickname;
  const username = readString(me.username).trim();
  if (username) return username;
  return readString(me.email_masked).trim() || "用户";
}

export function projectEmailMasked(me: Record<string, unknown>): string | null {
  const email = readString(me.email_masked).trim();
  return email || null;
}

// ---- 模型目录展示元数据解析（组合条目；服务端已做时间判定与白名单） ----

const MODEL_DISPLAY_TAGS: readonly QuotaModelDisplayTag[] = [
  "recommended",
  "limited_time",
  "peak_pricing",
];

/** 白名单标签解析：非数组/非字符串/白名单外/重复全部丢弃（保序去重）。 */
function parseModelDisplayTags(value: unknown): QuotaModelDisplayTag[] {
  if (!Array.isArray(value)) return [];
  const out: QuotaModelDisplayTag[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      MODEL_DISPLAY_TAGS.includes(item as QuotaModelDisplayTag) &&
      !out.includes(item as QuotaModelDisplayTag)
    ) {
      out.push(item as QuotaModelDisplayTag);
    }
  }
  return out;
}

/** 限时折扣载荷：服务端「生效才下发」，这里只验形；ends_at 归一到毫秒。 */
function parseModelPromo(value: unknown): QuotaModelPromo | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const label = readString(record.label).trim();
  if (!label) return null;
  const note = readString(record.note).trim();
  const endsAtSeconds = readNumber(record.ends_at);
  return {
    label,
    note: note || null,
    endsAt: endsAtSeconds !== null && endsAtSeconds > 0 ? normalizeEpochMs(endsAtSeconds) : null,
  };
}

/**
 * 模型目录 data 数组 → 条目列表（/v1/models 与免登录 /app-updates/models 共用同一
 * 构建器与同一解析：组合展示元数据透传，直连模型条目字段缺省）。
 */
export function projectModelCatalogEntries(data: unknown): QuotaModelCatalogEntry[] {
  const items = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  return items
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: item.id as string,
      multiplier: readNumber(item.multiplier),
      tags: parseModelDisplayTags(item.tags),
      promo: parseModelPromo(item.promo),
    }));
}

/**
 * 后端 expires_at 是 Unix **秒**（32 位 Integer 列）；前端 Date/Intl 一律要毫秒。
 * 容错：若上游某天改发毫秒（>1e12），原样保留，避免二次放大。
 */
function normalizeEpochMs(seconds: number): number {
  if (seconds <= 0) return 0;
  return seconds > 1e12 ? seconds : seconds * 1000;
}

/**
 * 投影单个订阅（原始字段名为当前供应商口径）。
 * credits 与 per_call 两种计费模式的字段互斥，按 billing_mode 分支。
 */
import type {
  QuotaCheckinResult,
  QuotaCheckinStatus,
  QuotaModelCatalogEntry,
  QuotaModelDisplayTag,
  QuotaModelPromo,
  QuotaNotice,
  QuotaPasswordResetParams,
  QuotaRechargeOrderCreated,
  QuotaRechargeOrderStatus,
  QuotaRegisterParams,
  QuotaRegisterStatus,
  QuotaResetCard,
  QuotaSubscription,
} from "./quotaTypes.js";
export function projectSubscription(raw: Record<string, unknown>):
  | QuotaSubscription
  | null
  | {
      kind: "credits" | "per_call";
      id: number;
      planName: string;
      status: string;
      remaining: number;
      remainingCalls: number | null;
      totalCalls: number | null;
      callsUsed: number | null;
      creditsTotal: number | null;
      used5h: number | null;
      limit5h: number | null;
      usedWeekly: number | null;
      limitWeekly: number | null;
      next5hRefreshAt: number;
      nextWeekResetAt: number;
      hoursLeft: number;
      expiresAt: number;
      periodDays: number | null;
      fallbackToWallet: boolean;
      autoRenew: boolean;
    }
  | null {
  const id = readNumber(raw.id);
  if (id === null) return null;
  const billingMode = readString(raw.billing_mode);
  const status = readString(raw.status) || "active";
  const planName = readString(raw.plan_name) || "套餐";
  const expiresAt = normalizeEpochMs(readNumber(raw.expires_at) ?? 0);
  const next5hRefreshAt = normalizeEpochMs(readNumber(raw.next_5h_refresh_at) ?? 0);
  const nextWeekResetAt = normalizeEpochMs(readNumber(raw.next_week_reset_at) ?? 0);

  if (billingMode === "per_call") {
    const totalCalls = readNumber(raw.total_calls) ?? 0;
    const callsUsed = readNumber(raw.calls_used) ?? 0;
    return {
      kind: "per_call",
      id,
      planName,
      status,
      remaining: readNumber(raw.remaining_calls) ?? Math.max(0, totalCalls - callsUsed),
      remainingCalls: readNumber(raw.remaining_calls),
      totalCalls,
      callsUsed,
      creditsTotal: null,
      used5h: null,
      limit5h: null,
      usedWeekly: null,
      limitWeekly: null,
      next5hRefreshAt: 0,
      nextWeekResetAt: 0,
      hoursLeft: readNumber(raw.hours_left) ?? 0,
      expiresAt,
      periodDays: readNumber(raw.period_days),
      fallbackToWallet: true,
      autoRenew: false,
    };
  }

  return {
    kind: "credits",
    id,
    planName,
    status,
    remaining: readNumberOr(raw.remaining, 0),
    remainingCalls: null,
    totalCalls: null,
    callsUsed: null,
    creditsTotal: readNumber(raw.credits_total) ?? 0,
    used5h: readNumber(raw.used_5h),
    limit5h: readNumber(raw.limit_5h),
    usedWeekly: readNumber(raw.used_weekly),
    limitWeekly: readNumber(raw.limit_weekly),
    next5hRefreshAt,
    nextWeekResetAt,
    hoursLeft: readNumber(raw.hours_left) ?? 0,
    expiresAt,
    periodDays: null,
    fallbackToWallet: raw.fallback_to_wallet !== false,
    autoRenew: raw.auto_renew === true,
  };
}

export function projectUsageDay(raw: Record<string, unknown>) {
  return {
    date: readString(raw.date),
    requests: readNumber(raw.requests),
    charged: readNumber(raw.charged),
    cacheHitRate: readNumber(raw.cache_hit_rate),
  };
}

/** 重置卡清单条目投影（坏形状丢弃返回 null）。 */
export function projectResetCard(raw: Record<string, unknown>): QuotaResetCard | null {
  const id = readNumber(raw.id);
  if (id === null) return null;
  return {
    id,
    window: readString(raw.window),
    expiresAt: normalizeEpochMs(readNumber(raw.expires_at) ?? 0),
    expired: raw.expired === true,
    blockedReason: readString(raw.blocked_reason),
    cooldownLeftMin: readNumberOr(raw.cooldown_left_min, 0),
    dailyUsed: readNumberOr(raw.daily_used, 0),
    dailyLimit: readNumber(raw.daily_limit),
  };
}
