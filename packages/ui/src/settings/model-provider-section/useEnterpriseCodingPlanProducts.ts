/**
 * Polaris：Coding Plan（官方套餐）购买/定价面已随红线砍除。
 * 此桩保导入形状与 hook 返回形状（恒空目录、恒非加载），供核心 provider 设置导航消费，零出网。
 */

/** 官方套餐定价响应（协议形状；本端不再请求）。 */
export type EnterpriseCodingPlanPricingResponse = {
  productList: Array<Record<string, unknown>>;
};

export type EnterpriseCodingPlanProductDisplay = Record<string, unknown>;

export interface EnterpriseCodingPlanProductsSnapshot {
  productList: EnterpriseCodingPlanProductDisplay[];
  raw: EnterpriseCodingPlanPricingResponse;
  authenticated: boolean;
  staticProductIds?: string[];
}

export function shouldRetainEnterprisePricingSnapshotForRefresh(
  _snapshot: EnterpriseCodingPlanProductsSnapshot | null,
  _authenticated: boolean,
): boolean {
  void _snapshot;
  void _authenticated;
  return false;
}

export function resolveEnterprisePricingFailureSnapshot(params: {
  currentSnapshot: EnterpriseCodingPlanProductsSnapshot | null;
  authenticated: boolean;
  staticProducts: EnterpriseCodingPlanProductDisplay[] | undefined;
  family?: string;
}): EnterpriseCodingPlanProductsSnapshot | null {
  void params;
  return null;
}

export function useEnterpriseCodingPlanProducts(params?: {
  enabled?: boolean;
  authenticated?: boolean;
  family?: string;
  staticOnly?: boolean;
}): {
  snapshot: EnterpriseCodingPlanProductsSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  void params;
  return {
    snapshot: null,
    loading: false,
    error: null,
    refresh: async () => undefined,
  };
}
