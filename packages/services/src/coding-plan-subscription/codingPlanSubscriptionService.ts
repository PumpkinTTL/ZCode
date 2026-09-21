import {
  DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  resolveDynamicWorkflowClientConfig,
} from "@zcode/shared";
import type { ApiClient } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/provider";
import type { ICredentialService } from "../credential/credential.js";
import type {
  ICodingPlanSubscriptionService,
  OffPeakClientConfig,
} from "./codingPlanSubscription.js";

interface CodingPlanSubscriptionServiceDependencies {
  apiClient: ApiClient;
  credentialService: Pick<ICredentialService, "load">;
  resolveOffPeakModelSelectionView?: () => Promise<ModelSelectionView>;
}

/** 空实现的模型选择视图：没有 Built-in 模型成员，闲时任务因此保持关闭。 */
const EMPTY_MODEL_SELECTION_VIEW: ModelSelectionView = Object.freeze({
  revision: 0,
  providers: Object.freeze([]),
});

const EMPTY_OFF_PEAK_CLIENT_CONFIG: OffPeakClientConfig = Object.freeze({
  enabled: false,
  modelSelectionView: EMPTY_MODEL_SELECTION_VIEW,
});

/**
 * Polaris fork：官方计费实现（z.ai / bigmodel Coding Plan 订阅 provider）已整体移除。
 *
 * 工厂保留原有签名与返回类型，改为返回一个**空实现**：所有方法直接返回空值
 * （undefined / [] / {} / 已 resolve 的空 Promise），不发任何网络请求、不抛错。
 * 调用方（装配层、off-peak、动态工作流灰度、UI 的套餐面板）因此可以继续按接口调用，
 * 只是读到的永远是「无套餐」事实。
 *
 * 接自有套餐时：在这里实现 ICodingPlanSubscriptionService（依赖对象已按原样保留：
 * apiClient / credentialService / resolveOffPeakModelSelectionView），调用点无需改动。
 */
const EMPTY_CODING_PLAN_SUBSCRIPTION_SERVICE = {
  batchPreview: async () => ({ productList: [], isSubscribed: false, isAuthenticated: null }),
  getStaticProducts: async () => ({}),
  getStaticTeamProducts: async () => ({}),
  getStartPlanPreview: async () => null,
  getOffPeakClientConfig: async () => EMPTY_OFF_PEAK_CLIENT_CONFIG,
  // 远端灰度已随官方计费一并移除：只保留本地覆盖（ZCODE_DYNAMIC_WORKFLOW_MODE），
  // 缺省 fail-closed 为 disabled，因此不会给建会话路径引入任何等待。
  getDynamicWorkflowClientConfig: async () =>
    resolveDynamicWorkflowClientConfig({ remote: undefined, env: process.env }),
  // 兼容接口：固定返回 preflight-v1，不读取远端配置或缓存。
  getModelContextBudgetStrategy: async () => DEFAULT_ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  getForceUpdateConfig: async () => null,
  productInfo: async (request) => ({ productId: request.productId }),
  preview: async (request) => ({ bizId: "", productId: request.productId }),
  createSign: async () => ({ sign: "" }),
  updateSign: async () => ({ sign: "" }),
  checkPayment: async () => ({ status: "" }),
  checkPendingOrders: async () => ({ hasPendingOrders: false }),
  queryStripeCards: async () => [],
  bindStripeCard: async (request) => ({ paymentMethodId: request.paymentMethodId }),
  unbindStripeCard: async () => "",
  payStripe: async () => ({}),
  checkPaypalSupport: async () => ({ isSupport: false }),
  createPaypalSetupToken: async () => ({}),
  subscribePaypal: async () => ({}),
  getEnterprisePricing: async () => ({ productList: [] }),
  getEnterpriseBalance: async () => ({ giveBalance: 0, cashBalance: 0, totalBalance: 0 }),
  calculateEnterpriseOrder: async () => ({
    totalOriginalAmount: 0,
    totalPayAmount: 0,
    thirdPayAmount: 0,
  }),
  createEnterpriseOrder: async () => ({
    orderNo: "",
    totalOriginalAmount: 0,
    totalPayAmount: 0,
    thirdPayAmount: 0,
  }),
  getEnterprisePendingOrders: async () => [],
  cancelEnterpriseOrder: async (request) => ({ orderNo: request.orderNo, status: "" }),
  continueEnterpriseOrderPayment: async (request) => ({
    orderNo: request.orderNo,
    totalOriginalAmount: 0,
    totalPayAmount: 0,
    thirdPayAmount: 0,
  }),
  checkEnterpriseOrderStatus: async (request) => ({
    orderNo: request.orderNo,
    paymentStatus: "",
  }),
} satisfies ICodingPlanSubscriptionService;

// 冻结：装配层可能多处持有同一实例（Host 装配与 remote workspace 装配），
// 空实现不应被任何调用点就地改写。
Object.freeze(EMPTY_CODING_PLAN_SUBSCRIPTION_SERVICE);

export function createCodingPlanSubscriptionService(
  dependencies: CodingPlanSubscriptionServiceDependencies,
): ICodingPlanSubscriptionService {
  // 空实现不消费依赖；参数保留以维持既有装配点（node.ts / desktop remote Host）的调用兼容，
  // 将来接自有套餐时直接用这个依赖对象实现接口即可。
  void dependencies;
  return EMPTY_CODING_PLAN_SUBSCRIPTION_SERVICE;
}
