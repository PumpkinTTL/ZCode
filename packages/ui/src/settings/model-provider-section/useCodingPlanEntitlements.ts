/**
 * Polaris：Coding Plan 权益查询已随红线砍除。
 * 此桩保 hook 导入形状：恒无权益、恒非加载，消费方（composer 计划分组）自然不渲染官方套餐组，零出网。
 */
import { useCallback } from "react";
import type { ProviderSettingsView } from "@zcode/services";

export type CodingPlanEntitlementState = "none" | "active" | "loading" | "error";

export interface CodingPlanEntitlementsResult {
  state: CodingPlanEntitlementState;
  subscribedTeamProducts: Array<Record<string, unknown>>;
  refresh: () => Promise<void>;
}

export function useCodingPlanEntitlements(_view: ProviderSettingsView | null): CodingPlanEntitlementsResult {
  void _view;
  const refresh = useCallback(async () => undefined, []);
  return { state: "none", subscribedTeamProducts: [], refresh };
}
