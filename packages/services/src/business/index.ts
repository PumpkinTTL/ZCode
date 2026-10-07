/**
 * business barrel —— Polaris 自有业务服务面的统一出口（与 ui/src/business/ 对应）。
 *
 * 删除本目录即整体下线（quota + app-update）：登录/额度/更新检查等业务实现不掺进
 * 上游服务树，新增业务面先在此登记出口，再由 src/index.ts / src/node.ts 从本 barrel 取用。
 */
export {
  createQuotaService,
  DEFAULT_QUOTA_BASE_URL,
  DEV_QUOTA_BASE_URL,
  QUOTA_BASE_URL_ENV_KEY,
  resolveQuotaBaseUrl,
} from "./quota/quotaService.js";
export {
  IProviderQuotaService,
  NIMBUS_AGENT_KEY_CREDENTIAL_KEY,
  NIMBUS_AGENT_KEY_NAME,
  NIMBUS_CLIENT_ID,
  NIMBUS_DEVICE_CREDENTIAL_KEY,
  QUOTA_TOKEN_CREDENTIAL_KEY,
  QUOTA_USERNAME_CREDENTIAL_KEY,
} from "./quota/quota.js";
export { QuotaApiError } from "./quota/quotaClient.js";
export type {
  QuotaStatusResult,
  QuotaStatus,
  QuotaAccount,
  QuotaWalletInfo,
  QuotaSubscription,
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaViewKind,
  QuotaUsageDay,
  QuotaResetCard,
  QuotaRegisterStatus,
  QuotaRegisterParams,
  QuotaPasswordResetParams,
  QuotaRechargeOrderCreated,
  QuotaRechargeOrderStatus,
  QuotaNotice,
  QuotaCheckinStatus,
  QuotaCheckinResult,
} from "./quota/quotaTypes.js";
// App 更新检查 / 版本目录（更新日志）/ 在线心跳（cbcn-cloud app_release.py 契约）。
export {
  APP_UPDATE_CHANNEL,
  APP_UPDATE_CLIENT_ID,
  IAppUpdateService,
} from "./appUpdate/appUpdate.js";
export {
  APP_UPDATE_HEARTBEAT_INTERVAL_MS,
  APP_UPDATE_RELEASE_LIST_MAX,
  createAppUpdateService,
  resolveAppUpdatePlatform,
} from "./appUpdate/appUpdateService.js";
export { AppUpdateApiError } from "./appUpdate/appUpdateClient.js";
export type {
  AppUpdateServiceHandle,
  CreateAppUpdateServiceOptions,
} from "./appUpdate/appUpdateService.js";
export type {
  AppReleaseFile,
  AppReleaseHistoryEntry,
  AppReleaseVersion,
  AppUpdateCheck,
  AppUpdateCheckResult,
} from "./appUpdate/appUpdateTypes.js";
