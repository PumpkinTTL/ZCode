/**
 * 「是否 Nimbus 提供商」的统一判定：模型设置详情卡与上下文容量弹窗共用，避免两处各写一份口径。
 * 判定常数（模板 id / 展示名）也住在这里，provisionNimbusProvider 反向复用本模块（单向依赖）。
 *
 * 三级判定（从强到弱）：
 * 1. 模板：模板系统里带 templateId=nimbus 的官方模板供应商；
 * 2. 展示名：登录自动开通的 "Nimbus"（模板缺失时的等价配方路径）；
 * 3. API 同源：手工建的本地联调供应商（如 "NimbusLocal"）——其 api.baseUrl 与额度服务
 *    的 base 同源时同样认领，保证「额度在哪个中继、哪张卡就出现在哪个供应商下面」。
 */

export const NIMBUS_TEMPLATE_ID = "nimbus";
/** 供应商展示名；同时作为模板缺失时的识别标记（那时没有 templateId 可用）。 */
export const NIMBUS_PROVIDER_LABEL = "Nimbus";

export interface NimbusProviderLike {
  readonly providerName?: string | null;
  readonly templateId?: string | null;
  readonly api?: { readonly baseUrl?: string | null } | null;
}

/** 取 URL 的 scheme://host[:port]；非法/空值返回 null。 */
export function providerBaseOrigin(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function isNimbusProvider(
  provider: NimbusProviderLike | null | undefined,
  quotaBaseUrl?: string | null,
): boolean {
  if (!provider) return false;
  if (provider.templateId === NIMBUS_TEMPLATE_ID) return true;
  if ((provider.providerName ?? "").trim() === NIMBUS_PROVIDER_LABEL) return true;
  const providerOrigin = providerBaseOrigin(provider.api?.baseUrl);
  const quotaOrigin = providerBaseOrigin(quotaBaseUrl);
  return providerOrigin !== null && quotaOrigin !== null && providerOrigin === quotaOrigin;
}
