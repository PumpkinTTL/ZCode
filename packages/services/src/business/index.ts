/**
 * business barrel —— Polaris 自有业务服务面的统一出口（与 ui/src/business/ 对应）。
 *
 * 删除本目录即整体下线（当前仅有 quota）：登录/额度等业务实现不掺进上游服务树，
 * 新增业务面先在此登记出口，再由 src/index.ts / src/node.ts 从本 barrel 取用。
 */
export {
  createQuotaService,
  DEFAULT_QUOTA_BASE_URL,
  DEV_QUOTA_BASE_URL,
  QUOTA_API_KEY_NAME,
  QUOTA_BASE_URL_ENV_KEY,
  resolveQuotaBaseUrl,
} from "./quota/quotaService.js";
export {
  IProviderQuotaService,
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
} from "./quota/quotaTypes.js";
