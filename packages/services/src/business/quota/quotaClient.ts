/**
 * 供应商额度 HTTP 客户端（纯函数，无状态；供应商差异只在 baseUrl 配置）。
 *
 * 协议要点（当前供应商的调用文档）：
 * - 登录路径是 /api/v1/user/login（不是 /api/v1/login），用户侧路由统一挂 /user 前缀
 * - token 只放 Authorization Header，不放 URL query（会进访问日志）
 * - 错误响应统一形如 { detail: string }，detail 是给最终用户看的中文，可直接展示
 * - 401 = token 过期/登出 → 需重新登录；429 → 读 Retry-After
 */

const LOGIN_PATH = "/api/v1/user/login";
const LOGOUT_PATH = "/api/v1/user/logout";
const ME_PATH = "/api/v1/user/me";
const PLANS_PATH = "/api/v1/user/plans";
const USAGE_DAILY_PATH = "/api/v1/user/usage/daily";

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
    typeof body?.detail === "string"
      ? body.detail
      : `额度服务请求失败（HTTP ${response.status}）`;
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
    const response = await this.#fetchImpl(
      `${this.#baseUrl}${USAGE_DAILY_PATH}?days=${clamped}`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { items?: unknown } | null;
    return Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : [];
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

/**
 * 投影单个订阅（原始字段名为当前供应商口径）。
 * credits 与 per_call 两种计费模式的字段互斥，按 billing_mode 分支。
 */
import type { QuotaSubscription } from "./quotaTypes.js";
export function projectSubscription(raw: Record<string, unknown>): QuotaSubscription | null
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
  const expiresAt = readNumber(raw.expires_at) ?? 0;

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
