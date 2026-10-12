/**
 * App 更新/在线服务实现：更新检查 + 更新日志 + 在线心跳。
 *
 * 职责边界：本文件只做「装配 + 路径钳位 + 投影」；HTTP 细节在 appUpdateClient.ts，
 * 对外契约在 appUpdate.ts。
 *
 * 与额度服务的关系：**同一后端、同一 base 解析出口**（复用
 * quotaService.resolveQuotaBaseUrl：QUOTA_BASE_URL 覆盖 > 未打包(development)
 * 本地 127.0.0.1:8000 > 打包域名），保证两边永远指向同一部署；心跳身份键与
 * electron manifest 通道（device_mid）同值优先，缺口时回落额度层的
 * NimbusDeviceKeyProvider（Ed25519 身份单实例），不另造一套。
 *
 * 鉴权：三个端点都是公开端点（无 JWT，见 appUpdate.ts 头注）——本服务不读
 * 登录 token，因此**未登录也能上报在线/检查更新**（这正是后端的设计意图：
 * AppID 是客户端公开标识，在线数按设备身份去重）。
 */
import type { NimbusDeviceKeyProvider } from "../quota/quota.js";
import type { QuotaModelCatalogEntry } from "../quota/quotaTypes.js";
import { resolveQuotaBaseUrl } from "../quota/quotaService.js";
import { APP_UPDATE_CHANNEL, APP_UPDATE_CLIENT_ID } from "./appUpdate.js";
import type { IAppUpdateService } from "./appUpdate.js";
import {
  AppUpdateApiClient,
  AppUpdateApiError,
  projectReleaseHistoryEntry,
  projectUpdateCheck,
} from "./appUpdateClient.js";
import type { AppReleaseHistoryEntry, AppUpdateCheckResult } from "./appUpdateTypes.js";

/**
 * 在线心跳周期。后端窗口是 Redis 5 分钟滑动 TTL（cbcn-cloud
 * app_release.py:59 `_ONLINE_TTL_SECONDS = 300`），取 4 分钟：每台设备在窗口内
 * 至少留下两次心跳，留 60s 容错（网络抖动/休眠唤醒），同时远低于后端
 * 60 次/分钟/IP 的限流（app_release.py:36）。
 */
export const APP_UPDATE_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;

/** 版本目录单次拉取上限（后端钳位 1..100，app_release.py:287）。 */
export const APP_UPDATE_RELEASE_LIST_MAX = 100;

/**
 * 后端更新检查的平台名不是 Node 的 process.platform：
 * app_release.py:38 只接受 ""/"windows"/"macos"/"linux"（其他值直接 400）。
 * 未知平台映射为 ""（后端语义 = 平台通用版本），绝不猜一个后端不认的名字。
 */
export function resolveAppUpdatePlatform(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return "";
  }
}

export interface CreateAppUpdateServiceOptions {
  /**
   * 当前产品版本（编译期 ZCODE_VERSION），更新检查的 current_version 与心跳的
   * version 都用它；后端据此判定 update_available / required。
   */
  readonly appVersion: string;
  /** 更新检查平台名，缺省按 process.platform 映射（resolveAppUpdatePlatform）。 */
  readonly platform?: string;
  /** 发布通道，缺省 stable。 */
  readonly channel?: string;
  /** AppID，缺省 `polaris`（与设备/agent key 同一 apps 行）。 */
  readonly clientId?: string;
  /**
   * 桌面端持久化设备标识（主进程 telemetry-state.json 的 deviceMid，经 Host init
   * 下发）。与 electron manifest 通道上报的 device_mid 是**同一个值**——服务端
   * 在线统计按 identity 去重（SCAN + 去重，见 app_release.py:54-58），两个通道
   * 对同一台机器必须落同一身份键，否则同设备双计。且它先于登录存在：未配对
   * 用户也能按设备稳定归属；未提供（非桌面宿主/web）时才回落 Nimbus device id。
   */
  readonly deviceMid?: string;
  /**
   * 设备身份能力（可选）：无 deviceMid 时的回落——心跳带上 device_id 让后端按设备
   * 去重在线数（app_release.py:94-98；再缺省回落 IP+UA 哈希，同 IP 多机折叠成一台）。
   * 与额度服务共用同一个 provider 实例；不传时心跳仍可用（device 传空串）。
   */
  readonly deviceKeys?: NimbusDeviceKeyProvider;
  /**
   * 内置心跳定时器周期（毫秒）；缺省 0 = 不自动上报（测试/web 装配不受影响）。
   * 传正值时创建即开始：先立即报一次（让管理端在线数在启动后立刻可见），
   * 之后按周期上报；定时器 unref（不阻塞进程退出）。
   */
  readonly heartbeatIntervalMs?: number;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: {
    warn: (...args: unknown[]) => void;
  };
}

/** createAppUpdateService 的返回：RPC 契约 + 本地生命周期（停止心跳定时器）。 */
export interface AppUpdateServiceHandle {
  readonly service: IAppUpdateService;
  /** 停止内置心跳定时器（幂等）；不调用也不阻塞进程退出（定时器已 unref）。 */
  stopHeartbeat(): void;
}

export function createAppUpdateService(
  options: CreateAppUpdateServiceOptions,
): AppUpdateServiceHandle {
  const baseUrl = options.baseUrl?.trim() || resolveQuotaBaseUrl();
  const clientId = options.clientId?.trim() || APP_UPDATE_CLIENT_ID;
  const channel = options.channel?.trim() || APP_UPDATE_CHANNEL;
  const platform = options.platform ?? resolveAppUpdatePlatform();
  const appVersion = options.appVersion.trim();
  const client = new AppUpdateApiClient({ baseUrl, fetchImpl: options.fetchImpl });
  const deviceKeys = options.deviceKeys;
  const configuredDeviceMid = options.deviceMid?.trim() ?? "";

  /**
   * 心跳身份键：与 electron manifest 通道（device_mid）同键优先——所有上报
   * 通道（独立心跳 / latest 更新检查 / manifest）对同一设备必须上报同一字符串，
   * 服务端才去得掉重；取不到时回落 Nimbus device id，都没有返回空串 →
   * 后端按 IP+UA 哈希归属。
   */
  async function resolveDeviceId(): Promise<string> {
    if (configuredDeviceMid) return configuredDeviceMid;
    if (!deviceKeys) return "";
    try {
      const identity = await deviceKeys.loadOrCreate();
      return identity.deviceId ?? "";
    } catch (error) {
      options.logger?.warn("[app-update] 读取设备身份失败，心跳按无设备上报", error);
      return "";
    }
  }

  /** 单次心跳：best-effort —— 任何失败只记日志并返回 false，绝不影响调用方。 */
  async function reportHeartbeat(): Promise<boolean> {
    try {
      const device = await resolveDeviceId();
      return await client.postHeartbeat({ clientId, version: appVersion, device, platform });
    } catch (error) {
      options.logger?.warn("[app-update] 在线心跳上报失败（忽略）", error);
      return false;
    }
  }

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = (): void => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 0;
  if (heartbeatIntervalMs > 0) {
    // 启动即报一次：管理端在线面板不必等满一个周期才看到本机。
    void reportHeartbeat();
    heartbeatTimer = setInterval(() => {
      void reportHeartbeat();
    }, heartbeatIntervalMs);
    // unref：心跳是纯统计用途，绝不能拖住 host 进程退出（同 bots/channelRuntime.ts 姿态）。
    heartbeatTimer.unref?.();
  }

  const service: IAppUpdateService = {
    async checkForUpdate(): Promise<AppUpdateCheckResult> {
      try {
        const raw = await client.fetchLatest({
          clientId,
          platform,
          channel,
          currentVersion: appVersion,
          // 更新检查即心跳（后端 _record_heartbeat）：带同一身份键，避免同机
          // 在「检查」与「独立心跳」两条链上按两个身份被双计。
          device: await resolveDeviceId(),
        });
        return projectUpdateCheck(raw);
      } catch (error) {
        // 404 = 未知应用或暂无发布版本（app_release.py:148-163 同一口径）：
        // Polaris 尚未发版是正常状态，翻译成 null 交给 UI 展示「暂无发布版本」。
        if (error instanceof AppUpdateApiError && error.status === 404) return null;
        throw error;
      }
    },

    async listPublicModelIds(): Promise<readonly string[]> {
      try {
        return await client.fetchPublicModelIds();
      } catch (error) {
        // 404（未知应用）按空目录处理，与 checkForUpdate 同一口径；其余照抛。
        if (error instanceof AppUpdateApiError && error.status === 404) return [];
        throw error;
      }
    },

    /** 同端点完整条目（含组合展示元数据）；404 按空目录，与 listPublicModelIds 同口径。 */
    async listPublicModelCatalog(): Promise<readonly QuotaModelCatalogEntry[]> {
      try {
        return await client.fetchPublicModelCatalog();
      } catch (error) {
        if (error instanceof AppUpdateApiError && error.status === 404) return [];
        throw error;
      }
    },

    async listReleases(limit?: number): Promise<readonly AppReleaseHistoryEntry[]> {
      const clamped = Math.min(APP_UPDATE_RELEASE_LIST_MAX, Math.max(1, Math.trunc(limit ?? 20)));
      const raw = await client.fetchVersions({ clientId, channel, limit: clamped });
      const versions =
        typeof raw === "object" &&
        raw !== null &&
        Array.isArray((raw as { versions?: unknown }).versions)
          ? ((raw as { versions: unknown[] }).versions as unknown[])
          : [];
      return versions
        .map((entry) => projectReleaseHistoryEntry(entry))
        .filter((entry): entry is AppReleaseHistoryEntry => entry !== null);
    },

    reportHeartbeat,

    async getBaseUrl(): Promise<string> {
      return baseUrl;
    },
  };

  return { service, stopHeartbeat };
}
