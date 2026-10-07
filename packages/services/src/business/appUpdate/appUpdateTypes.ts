/**
 * Polaris 自有业务：App 更新检查 / 版本目录（更新日志）/ 在线心跳的领域类型。
 *
 * 契约出处（cbcn-cloud，只读对接，字段名与语义以后端为准）：
 * - backend/app/api/v1/app_release.py:113  GET /api/v1/user/app-updates/{client_id}/latest
 * - backend/app/api/v1/app_release.py:210  POST /api/v1/user/app-updates/{client_id}/heartbeat
 * - backend/app/api/v1/app_release.py:254  GET /api/v1/user/app-updates/{client_id}/versions
 *
 * 字段口径沿用 quota 层同一原则「看不到的字段不要猜」：投影层容错读法，
 * 缺键/坏形状不抛错，交给 UI 按缺省值渲染。
 */

/** 安装包描述（latest 响应里的 file 段）。 */
export interface AppReleaseFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly md5: string;
  /**
   * 下载链接：R2 未配置/生成失败时为空串；配置了公开域为直链，否则为
   * SigV4 预签名（默认 1 小时有效，见 core/app_release.py:144）——拿到后应尽快下载。
   */
  readonly url: string;
}

/** 一个已发布版本（latest 响应里的 latest 段）。 */
export interface AppReleaseVersion {
  readonly version: string;
  readonly platform: string;
  readonly channel: string;
  /** 更新日志正文（管理端上传时填写，可空） */
  readonly notes: string;
  /** 该版本自身标记的强制更新（版本级） */
  readonly forced: boolean;
  /** 发布时间戳（毫秒；后端为 Unix 秒，投影层已归一，未见值为 0） */
  readonly publishedAt: number;
  readonly file: AppReleaseFile;
}

/** 一次更新检查的结果（后端镜像 apps 表 + 最新版本 + 强制更新判定）。 */
export interface AppUpdateCheck {
  readonly clientId: string;
  /** 应用显示名（管理端 apps 表维护） */
  readonly name: string;
  readonly platform: string;
  readonly channel: string;
  /** 存在比当前版本更新的版本（后端按语义版本比较，见 core/app_release.py:207） */
  readonly updateAvailable: boolean;
  /**
   * 强制升级：低于报废门槛 min_version，或最新版本标了 forced。
   * 服务端权威判定，客户端只执行——required=true 时不允许「稍后提醒」跳过。
   */
  readonly required: boolean;
  /** 报废门槛（未配置为 null） */
  readonly minVersion: string | null;
  readonly latest: AppReleaseVersion;
}

/** 版本目录条目（更新日志页用；与 latest 不同，不含下载链接）。 */
export interface AppReleaseHistoryEntry {
  readonly version: string;
  readonly platform: string;
  /** 通道（后端只有 stable/beta/alpha 三种） */
  readonly channel: string;
  readonly notes: string;
  readonly forced: boolean;
  /** 发布时间戳（毫秒；后端 Unix 秒已归一） */
  readonly publishedAt: number;
  readonly fileName: string;
  /** 安装包是否仍可下载（管理端删包保留日志后为 false） */
  readonly hasFile: boolean;
  readonly fileSize: number;
  readonly fileSha256: string;
}

/** 更新检查结果：null 表示后端没有该 App 的已发布版本（404，非错误）。 */
export type AppUpdateCheckResult = AppUpdateCheck | null;
