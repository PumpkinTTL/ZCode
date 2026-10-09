/**
 * App 更新/在线能力（更新检查 + 更新日志 + 在线心跳）的对外契约。
 *
 * 通道名注册在 `@zcode/shared` 的 `ServiceChannels.AppUpdate`；
 * UI 通过 `useServices().appUpdateService` 调用（与 provider-quota 同一条 RPC 通路）。
 *
 * 三个后端端点都是**公开端点**（无 JWT）：AppID 是客户端内置的公开标识，
 * 更新检查是桌面端更新器的标准做法（见 cbcn-cloud app_release.py 模块 docstring，
 * backend/app/api/v1/app_release.py:1-14），因此本服务不依赖登录态，也不需要设备签名。
 * 唯一用到设备身份的是心跳里的 device 字段——它只用于后端「在线身份去重」，
 * 缺省（无设备身份）时后端自动回落 IP+UA 哈希（app_release.py:83-88）。
 */
import { ServiceChannels } from "@zcode/shared";
import type { QuotaModelCatalogEntry } from "../quota/quotaTypes.js";
import { createServiceDescriptor } from "../../descriptors.js";
import { NIMBUS_CLIENT_ID } from "../quota/quota.js";
import type { AppReleaseHistoryEntry, AppUpdateCheckResult } from "./appUpdateTypes.js";

/**
 * 客户端 AppID（后端 apps 表主键）——与设备注册/agent key 用同一行 `polaris`，
 * 直接复用额度层的常量，避免两处字面量漂移。
 */
export const APP_UPDATE_CLIENT_ID = NIMBUS_CLIENT_ID;

/** 发布通道（后端仅支持 stable/beta/alpha，客户端默认走 stable）。 */
export const APP_UPDATE_CHANNEL = "stable";

export interface IAppUpdateService {
  /**
   * 更新检查：GET /user/app-updates/{client_id}/latest（cbcn-cloud app_release.py:113）。
   *
   * - 当前版本用本服务装配的 appVersion（编译期产品版本，见 appUpdateService）；
   * - 后端没有该 App 的已发布版本时返回 404 → 这里返回 **null**（不是错误：
   *   Polaris 尚未发版是正常状态，UI 展示「暂无发布版本」即可）；
   * - `required` 由服务端权威判定（报废门槛 or 版本级 forced），客户端必须执行。
   */
  checkForUpdate(): Promise<AppUpdateCheckResult>;
  /**
   * 已发布版本目录（新→旧，默认 20 条，后端上限 100）：
   * GET /user/app-updates/{client_id}/versions（app_release.py:254）。
   * 给「更新日志」页/排障用；已下架/已删包的版本不再出现（读侧只查 published=1）。
   */
  listReleases(limit?: number): Promise<readonly AppReleaseHistoryEntry[]>;
  /**
   * 公开模型目录（免登录）：/app-updates/models 的匿名视角模型 id 列表——
   * 「内置供应商免登录预同步」数据源（backend/app/api/v1/app_release.py:241）。
   * 未知应用（404）按空列表处理；失败抛 AppUpdateApiError。
   */
  listPublicModelIds(): Promise<readonly string[]>;
  /** 同端点完整目录（含组合倍率/标签/限时折扣展示元数据）；404 按空目录。 */
  listPublicModelCatalog(): Promise<readonly QuotaModelCatalogEntry[]>;
  /**
   * 在线心跳（单次）：POST /user/app-updates/{client_id}/heartbeat（app_release.py:210）。
   *
   * 后端把 (client, platform, channel, version, identity) 记进 Redis 5 分钟滑动窗口，
   * 管理端在线数 = 窗口内活跃身份去重数（app_release.py:50-92）。纯统计用途：
   * **best-effort，失败返回 false 不抛错**（在线数据不重要到能影响用户体验）。
   * 定时上报由服务内部的定时器负责（见 CreateAppUpdateServiceOptions.heartbeatIntervalMs）。
   */
  reportHeartbeat(): Promise<boolean>;
  /**
   * 本服务实际生效的 base URL（与额度服务同源：dev=本地 127.0.0.1:8000 /
   * 打包=域名 / QUOTA_BASE_URL 可覆盖），供 UI 展示或排障。
   */
  getBaseUrl(): Promise<string>;
}

export const IAppUpdateService = createServiceDescriptor<IAppUpdateService>(
  ServiceChannels.AppUpdate,
);
