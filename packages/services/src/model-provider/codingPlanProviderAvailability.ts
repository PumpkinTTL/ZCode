import type {
  ApiClient,
  ProviderFamilyConnectionSelectionSettings,
  ProviderFamilyDomain,
} from "@zcode/shared";

/**
 * Polaris fork：官方 Coding Plan（z.ai / bigmodel 的 Start Plan、个人套餐、Team Plan）
 * 已整体移除，本模块不再访问任何官方业务接口。
 *
 * 保留原因：账号域（Account Provider）仍以 Plan 可用性作为连接事实来源，
 * `accountProviderConnectionResolver` 通过这些导出把结果投影成对外的连接状态。
 * 现在所有官方 Plan 一律「不可用」，调用方据此把官方账号入口显示为未连接；
 * 第三方模型通道不经此路径，不受影响。
 *
 * 接自有套餐时：在 `validateXxxAccountProviderAvailability` 内按接口原样实现即可，
 * 签名与返回类型保持不变，调用点无需改动。
 */

export type CodingPlanUnavailableReason =
  | "coding_plan_not_authenticated"
  | "coding_plan_not_connected"
  | "coding_plan_auth_failed"
  | "coding_plan_not_entitled";

export type CodingPlanAvailabilityResult =
  | { kind: "available"; models?: readonly string[] }
  | { kind: "pending"; effectiveAt: number; models: readonly string[] }
  | { kind: "unavailable"; reason: CodingPlanUnavailableReason }
  | { kind: "unknown" };

export interface CodingPlanAvailabilityProvider {
  readonly providerId: string;
  readonly family: ProviderFamilyDomain;
  readonly planKind: "start-plan" | "individual-coding-plan" | "team-coding-plan";
  readonly apiKey?: string | null;
}

interface CodingPlanAvailabilityContext {
  apiClient?: ApiClient;
  credentialService?: CodingPlanAvailabilityCredentialService;
  providerFamilyConnectionSelections?: ProviderFamilyConnectionSelectionSettings;
}

interface CodingPlanAvailabilityCredentialService {
  load(key: string): Promise<string | null>;
}

const UNAVAILABLE: CodingPlanAvailabilityResult = {
  kind: "unavailable",
  reason: "coding_plan_not_connected",
};

/** 官方套餐已下架：任何 provider 都固定返回未连接，不再查询远端权益。 */
function resolveUnavailableAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
): Partial<Record<string, CodingPlanAvailabilityResult>> {
  const result: Record<string, CodingPlanAvailabilityResult> = {};
  for (const provider of providers) {
    result[provider.providerId] = UNAVAILABLE;
  }
  return result;
}

export async function validateZaiAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  context: CodingPlanAvailabilityContext,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  void context;
  return resolveUnavailableAvailability(providers);
}

export async function validateBigModelAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  context: CodingPlanAvailabilityContext,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  void context;
  return resolveUnavailableAvailability(providers);
}
