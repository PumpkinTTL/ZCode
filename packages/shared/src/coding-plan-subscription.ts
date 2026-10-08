/**
 * Coding Plan 订阅协议类型（Polaris 精简版）。
 *
 * 上游官方购买/订阅漏斗（z.ai / bigmodel 的套餐预览、Stripe/PayPal/支付宝支付、
 * 企业套餐报价等 60+ 死类型）已随 §22 购买漏斗移除一并清理，只保留强更配置——
 * 它是 desktop forceUpdateGuard 的活契约。OffPeak 客户端配置类型在
 * services/src/coding-plan-subscription/codingPlanSubscription.ts 本地定义。
 */
export interface ForceUpdateConfig {
  minimalVersion: string;
}
