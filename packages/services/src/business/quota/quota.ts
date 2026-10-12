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
  QuotaStatusResult,
  QuotaUsageDay,
} from "./quotaTypes.js";

/** 登录 token 的凭证存储键（与反馈服务 JWT 同一存储，不落 settings.json）。 */
export const QUOTA_TOKEN_CREDENTIAL_KEY = "provider-quota:token";
/** 登录用户名的凭证存储键（回显用）。 */
export const QUOTA_USERNAME_CREDENTIAL_KEY = "provider-quota:username";
/** 设备身份（含 Ed25519 私钥）的凭证存储键。 */
export const NIMBUS_DEVICE_CREDENTIAL_KEY = "provider-quota:device-identity";
/** 本设备 agent key 明文的凭证存储键（创建响应仅回一次，本地延续靠它）。 */
export const NIMBUS_AGENT_KEY_CREDENTIAL_KEY = "provider-quota:agent-key";
/**
 * agent key 明文按账号隔离的凭证键前缀（多账号共机：`provider-quota:agent-key:<账号>`）。
 * 账号键 = 用户名小写（NIMBUS 登录账号在服务端唯一）。切号只换指针：
 * 本账号明文读本账号键，绝不为另一账号的凭据做吊销/重建。legacy 单槽
 * （NIMBUS_AGENT_KEY_CREDENTIAL_KEY）只作升级迁移兜底并保持「最后使用」语义。
 */
export const NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX = "provider-quota:agent-key:";
/** agent key 归属的客户端 ID（后端 apps 表主键，运维侧预插行）。 */
export const NIMBUS_CLIENT_ID = "polaris";
/** agent key 显示名（不占用户手建 key 名额，固定名字便于在门户识别）。 */
export const NIMBUS_AGENT_KEY_NAME = "Polaris";

/**
 * 单账号的密钥档案引用（身份 JSON 内 accounts 映射的值）：切号时据此定位
 * 该账号名下的设备行与 key 标识。**明文不放这里**——明文在凭证服务按账号
 * 隔离存放（NIMBUS_AGENT_KEY_ACCOUNT_CREDENTIAL_PREFIX），与 token 同加密边界。
 */
export interface NimbusAccountKeyRef {
  readonly deviceId: string;
  readonly keyId: string | number | null;
  readonly keyPrefix: string | null;
}

/**
 * 本机设备身份。deviceId=null 表示尚未配对；私钥只进凭证存储（与 token 同一
 * 加密边界），绝不进日志/设置文件。accounts = 多账号凭据档案（账号键 →
 * 设备/key 引用），保证同机多账号切换零吊销、零重建。
 */
export interface NimbusDeviceIdentity {
  readonly deviceId: string | null;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly keyId: string | number | null;
  readonly keyPrefix: string | null;
  readonly accounts?: Readonly<Record<string, NimbusAccountKeyRef>>;
}

/**
 * 设备密钥能力（Ed25519 配对 + 请求签名）。生产实现用 node:crypto，由宿主
 * 组合根注入（见 nimbusDeviceIdentity.ts）；接口放契约层是为了让 quotaService
 * 只做 `import type`，渲染层 bundle 不引入 node 内建模块。
 */
export interface NimbusDeviceKeyProvider {
  /** 取（或首次生成并落盘）本机身份；注册失败也不丢密钥对。 */
  loadOrCreate(): Promise<NimbusDeviceIdentity>;
  /** 持久化身份（配对/认领回执写回）。 */
  save(identity: NimbusDeviceIdentity): Promise<void>;
  /** 为身份构造请求签名器（未配对时设备头填占位值）。 */
  createSigner(identity: NimbusDeviceIdentity): (
    descriptor: { method: string; pathWithQuery: string; body: string | null },
  ) => Record<string, string>;
  /** 注册上报的公钥形态：base64 裸 32 字节。 */
  publicKeyRawBase64(publicKeyPem: string): string;
  /** 注册上报的设备信息。 */
  deviceReport(): { readonly name: string; readonly platform: string; readonly appVersion: string };
}

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
  /**
   * 确保拿到本设备可用的 sk- 调用密钥（聊天用；与登录 token 是两回事）。
   *
   * 设备专属 agent key 方案（与 Lyra 同一后端契约）：首次登录自动注册设备
   * （Ed25519 配对）并认领 `via='agent'` 的设备绑定密钥——**不占用户手建 key
   * 名额**，每设备限一把，多端互不影响；已有则复用（明文存本机凭证库），
   * 明文断链（重装/在别处更换）时自动吊销旧 key 重签发。未登录抛 QuotaApiError(401)。
   */
  ensureApiKey(): Promise<string>;
  /**
   * 本服务实际生效的 base URL（dev=本地 127.0.0.1:8000 / 打包=域名 / QUOTA_BASE_URL
   * 可覆盖）。UI 装配 Nimbus 供应商时必须用它而不是编译期常量，保证与额度服务同源。
   */
  getBaseUrl(): Promise<string>;
  /** 用 sk- 密钥拉模型目录（OpenAI 兼容 /v1/models；组合条目带倍率/标签/折扣展示元数据）。 */
  getModelCatalog(apiKey: string): Promise<readonly QuotaModelCatalogEntry[]>;
  /**
   * 我的可用重置卡数量（GET /api/v1/user/reset-cards：已发放绑定本账号、
   * 未使用的用量重置卡）。未登录或查询失败返回 0（纯展示数据，不抛错）。
   */
  getResetCardCount(): Promise<number>;
  /** 重置卡全量清单（含窗口与可用性预检）；未登录抛 QuotaApiError(401)。 */
  listResetCards(): Promise<readonly QuotaResetCard[]>;
  /** 使用一张重置卡（POST /reset-cards/{id}/redeem）；失败抛 detail 中文。 */
  redeemResetCard(cardId: number): Promise<void>;
  /**
   * 注册开关预检（公开端点，无需登录）。登录页据此显隐注册入口与邮箱必填组；
   * 查询失败抛 QuotaApiError（调用方降级为「入口未知，点击注册时再预检」）。
   */
  registerStatus(signal?: AbortSignal): Promise<QuotaRegisterStatus>;
  /**
   * 注册并登录：后端注册成功即签发 JWT，本方法落凭证后拉一次全量额度
   * （返回形状与 login 完全一致，UI 复用登录完成流程）。失败抛 detail 中文，
   * 凭证不落库。
   */
  register(params: QuotaRegisterParams): Promise<QuotaStatusResult>;
  /** 发注册邮箱验证码（公开端点）；返回服务端提示文案，失败抛 detail。 */
  sendRegisterCode(email: string, signal?: AbortSignal): Promise<string>;
  /** 申请密码重置码（公开端点；防枚举恒成功），返回服务端提示文案。 */
  forgotPassword(email: string, signal?: AbortSignal): Promise<string>;
  /** 用重置码改密（公开端点）；成功后用户需用新密码登录，失败抛 detail。 */
  resetPassword(params: QuotaPasswordResetParams): Promise<void>;
  /**
   * 系统公告 + 全站灰纪念模式状态（GET /user/notice，公开端点免登录）。
   * 登录页与「我的额度」共用；查询失败抛 QuotaApiError（调用方静默降级不渲染）。
   */
  getNotice(signal?: AbortSignal): Promise<QuotaNotice>;
  /**
   * 每日签到状态（GET /user/checkin/status，JWT 鉴权）。功能关闭抛
   * QuotaApiError(403)「签到未开启」，UI 据此整体隐藏签到卡。
   */
  getCheckinStatus(): Promise<QuotaCheckinStatus>;
  /**
   * 每日签到（POST /user/checkin，JWT 鉴权）。成功返回本次奖励积分与连签天数；
   * 失败（重复签到等）抛 QuotaApiError，detail 为可直接展示的服务端中文。
   */
  checkin(): Promise<QuotaCheckinResult>;
  /**
   * 创建充值订单（POST /alipay/recharge，金额 10-2000 元，后端硬闸）。
   * 返回支付宝当面付二维码 URL，由 UI 用系统外链唤起支付宝。
   */
  createRechargeOrder(amount: number): Promise<QuotaRechargeOrderCreated>;
  /** 查询充值订单状态（pending | paid | closed）；轮询节流由后端 3s 键兜底。 */
  getRechargeOrder(orderNo: string): Promise<QuotaRechargeOrderStatus>;
  /** 取消待支付订单（非 pending 单后端 400，detail 可直接展示）。 */
  cancelRechargeOrder(orderNo: string): Promise<void>;
}

export const IProviderQuotaService = createServiceDescriptor<IProviderQuotaService>(
  ServiceChannels.ProviderQuota,
);
