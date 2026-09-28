/**
 * 供应商额度服务的对外契约。
 *
 * 通道名注册在 `@zcode/shared` 的 `ServiceChannels.ProviderQuota`；
 * UI 通过 `useServices().providerQuotaService` 调用（与 feedback/bots 同一条 RPC 通路）。
 *
 * 命名不绑定供应商：供应商只是 baseUrl 配置（见 quotaService 的 DEFAULT_QUOTA_BASE_URL），
 * 换供应商改配置即可，这一层的文件名/类型名/通道名都不用动。
 */
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../../descriptors.js";
import type { QuotaStatusResult, QuotaUsageDay } from "./quotaTypes.js";

/** 登录 token 的凭证存储键（与反馈服务 JWT 同一存储，不落 settings.json）。 */
export const QUOTA_TOKEN_CREDENTIAL_KEY = "provider-quota:token";
/** 登录用户名的凭证存储键（回显用）。 */
export const QUOTA_USERNAME_CREDENTIAL_KEY = "provider-quota:username";

export interface QuotaLoginParams {
  readonly username: string;
  readonly password: string;
}

export interface IProviderQuotaService {
  /**
   * 一次拉全量：登录态 + 账户 + 钱包 + 生效套餐 + 推荐额度视图。
   * 未登录返回 `{ loggedIn: false }`（UI 据此渲染登录入口，不抛错）。
   * token 失效（401）同样返回未登录态并清掉本地凭证。
   */
  getStatus(): Promise<QuotaStatusResult>;
  /** 账号密码登录；失败抛 QuotaApiError（detail 为可直接展示的中文）。 */
  login(params: QuotaLoginParams): Promise<QuotaStatusResult>;
  /** 登出：服务端拉黑 token + 清本地凭证。 */
  logout(): Promise<void>;
  /** 按天用量（N=1..90，钳位）；未登录返回空数组。 */
  getUsageDaily(days: number): Promise<readonly QuotaUsageDay[]>;
}

export const IProviderQuotaService = createServiceDescriptor<IProviderQuotaService>(
  ServiceChannels.ProviderQuota,
);
