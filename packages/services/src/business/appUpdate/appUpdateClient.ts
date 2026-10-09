/**
 * App 更新/在线能力 HTTP 客户端（纯函数 + 容错投影，无状态）。
 *
 * 路径均挂在用户侧前缀 /api/v1/user 下（app_release.router 无自身 prefix，
 * 经 api/v1/__init__.py:29-30 合并进 user.router，见 cbcn-cloud __init__.py 注释）：
 * - GET  /api/v1/user/app-updates/{client_id}/latest?platform=&channel=&current_version=
 * - GET  /api/v1/user/app-updates/{client_id}/versions?channel=&limit=
 * - POST /api/v1/user/app-updates/{client_id}/heartbeat  body {version, device, platform}
 *
 * 错误口径与 quotaClient 同款：非 2xx 抛 AppUpdateApiError，detail 是后端给的
 * 可直接展示的中文；latest 的 404（未发布任何版本）由服务层翻译成 null。
 */
import type {
  AppReleaseFile,
  AppReleaseHistoryEntry,
  AppReleaseVersion,
  AppUpdateCheck,
} from "./appUpdateTypes.js";
import { projectModelCatalogEntries } from "../quota/quotaClient.js";
import type { QuotaModelCatalogEntry } from "../quota/quotaTypes.js";

/** 非 2xx 时抛出；message 为可直接展示的中文文案。 */
export class AppUpdateApiError extends Error {
  readonly status: number;
  /** 服务端 detail 文案（可直接展示给用户） */
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `更新服务请求失败（HTTP ${status}）`);
    this.name = "AppUpdateApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface AppUpdateApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

// 容错读法（与 quotaClient 同一原则）：缺键/坏类型返回缺省值，绝不猜字段。
function readNumberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * 后端时间戳是 Unix **秒**（app_release.py 的 published_at 为 int 秒）；前端一律要毫秒。
 * 容错：>1e12 视为已是毫秒原样保留（与 quotaClient.normalizeEpochMs 同款防二次放大）。
 */
function normalizeEpochMs(seconds: number): number {
  if (seconds <= 0) return 0;
  return seconds > 1e12 ? seconds : seconds * 1000;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** 从错误响应里提取可直接展示的中文 detail；提取不到用 HTTP 状态兜底。 */
async function toApiError(response: Response): Promise<AppUpdateApiError> {
  const body = (await parseJson(response)) as { detail?: unknown } | null;
  const detail =
    typeof body?.detail === "string" ? body.detail : `更新服务请求失败（HTTP ${response.status}）`;
  return new AppUpdateApiError(response.status, detail);
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

// ============ 响应 → 领域类型的投影（字段名为 cbcn-cloud 口径，见各端点 schema） ============

function projectReleaseFile(raw: Record<string, unknown> | null): AppReleaseFile {
  return {
    name: readString(raw?.name),
    size: readNumberOr(raw?.size, 0),
    sha256: readString(raw?.sha256),
    md5: readString(raw?.md5),
    url: readString(raw?.url),
  };
}

/** latest 响应里 latest 段 → AppReleaseVersion（version 缺失返回 null，由调用方判空）。 */
export function projectAppReleaseVersion(raw: unknown): AppReleaseVersion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const version = readString(record.version);
  if (!version) return null;
  return {
    version,
    platform: readString(record.platform),
    channel: readString(record.channel),
    notes: readString(record.notes),
    forced: readBoolean(record.forced),
    publishedAt: normalizeEpochMs(readNumberOr(record.published_at, 0)),
    file: projectReleaseFile(
      typeof record.file === "object" && record.file !== null
        ? (record.file as Record<string, unknown>)
        : null,
    ),
  };
}

/**
 * latest 全量响应 → AppUpdateCheck；latest 段坏形状（无 version）返回 null
 * （视为「暂无可用版本」，与 404 同一展示口径，不让 UI 看到半截数据）。
 */
export function projectUpdateCheck(raw: unknown): AppUpdateCheck | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const latest = projectAppReleaseVersion(record.latest);
  if (latest === null) return null;
  const minVersion = readString(record.min_version).trim();
  return {
    clientId: readString(record.client_id),
    name: readString(record.name),
    platform: readString(record.platform),
    channel: readString(record.channel),
    updateAvailable: readBoolean(record.update_available),
    required: readBoolean(record.required),
    minVersion: minVersion || null,
    latest,
  };
}

/** versions 响应条目 → 更新日志条目（version 缺失丢弃返回 null）。 */
export function projectReleaseHistoryEntry(raw: unknown): AppReleaseHistoryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const version = readString(record.version);
  if (!version) return null;
  return {
    version,
    platform: readString(record.platform),
    channel: readString(record.channel),
    notes: readString(record.notes),
    forced: readBoolean(record.forced),
    publishedAt: normalizeEpochMs(readNumberOr(record.published_at, 0)),
    fileName: readString(record.file_name),
    hasFile: readBoolean(record.has_file),
    fileSize: readNumberOr(record.file_size, 0),
    fileSha256: readString(record.file_sha256),
  };
}

export class AppUpdateApiClient {
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: AppUpdateApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  #path(clientId: string, suffix: string): string {
    return `/api/v1/user/app-updates/${encodeSegment(clientId)}${suffix}`;
  }

  /**
   * 更新检查（无需鉴权）。404 照抛（服务层翻译成 null = 未发布任何版本）；
   * 后端限流 60 次/分钟/IP（app_release.py:34 "rl:appupd:latest"）。
   */
  async fetchLatest(
    input: {
      clientId: string;
      platform: string;
      channel: string;
      currentVersion: string;
    },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const query = new URLSearchParams();
    query.set("platform", input.platform);
    query.set("channel", input.channel);
    if (input.currentVersion) query.set("current_version", input.currentVersion);
    const path = `${this.#path(input.clientId, "/latest")}?${query.toString()}`;
    const response = await this.#fetchImpl(`${this.#baseUrl}${path}`, { signal });
    if (!response.ok) throw await toApiError(response);
    return await parseJson(response);
  }

  /** 已发布版本目录（新→旧；limit 由服务层钳位到 1..100）。 */
  async fetchVersions(
    input: { clientId: string; channel: string; limit: number },
    signal?: AbortSignal,
  ): Promise<unknown> {
    const query = new URLSearchParams();
    query.set("channel", input.channel);
    query.set("limit", String(input.limit));
    const path = `${this.#path(input.clientId, "/versions")}?${query.toString()}`;
    const response = await this.#fetchImpl(`${this.#baseUrl}${path}`, { signal });
    if (!response.ok) throw await toApiError(response);
    return await parseJson(response);
  }

  /**
   * 公开模型目录（免鉴权，backend/app/api/v1/app_release.py:241）：
   * 「内置供应商免登录预同步」的数据源——与 /v1/models 同一构建器的匿名视角。
   * 返回模型 id 列表；响应形状与 /v1/models 同构（data[].id），容错读法。
   */
  async fetchPublicModelIds(signal?: AbortSignal): Promise<string[]> {
    const response = await this.#fetchImpl(
      `${this.#baseUrl}/api/v1/user/app-updates/models`,
      { signal },
    );
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { data?: unknown } | null;
    const items = Array.isArray(body?.data) ? (body!.data as unknown[]) : [];
    return items
      .map((item) =>
        typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
          ? ((item as { id: string }).id).trim()
          : "",
      )
      .filter((id) => id.length > 0);
  }

  /**
   * 公开模型目录（免鉴权）：与 fetchPublicModelIds 同一端点、同一构建器；
   * 返回完整条目（含组合倍率/标签/限时折扣展示元数据，与 /v1/models 同构）。
   */
  async fetchPublicModelCatalog(signal?: AbortSignal): Promise<QuotaModelCatalogEntry[]> {
    const response = await this.#fetchImpl(
      `${this.#baseUrl}/api/v1/user/app-updates/models`,
      { signal },
    );
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { data?: unknown } | null;
    return projectModelCatalogEntries(body?.data);
  }

  /**
   * 在线心跳（无需鉴权）。device 传空串 = 交给后端按 IP+UA 哈希归属
   * （app_release.py:235-237 只在非空时用 body 里的 device 覆盖）。
   * 返回是否确认成功（后端回 {"ok": true}）。
   */
  async postHeartbeat(
    input: { clientId: string; version: string; device: string; platform: string },
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.#fetchImpl(
      `${this.#baseUrl}${this.#path(input.clientId, "/heartbeat")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: input.version,
          device: input.device,
          platform: input.platform,
        }),
        signal,
      },
    );
    if (!response.ok) throw await toApiError(response);
    const body = (await parseJson(response)) as { ok?: unknown } | null;
    return body?.ok !== false;
  }
}
