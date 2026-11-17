/**
 * Polaris：Start Plan（体验套餐）推荐已随红线砍除。
 * 此桩保留原 hook 形状：恒等解析——不拦截发送、不改写模型选择，零出网。
 */
export interface StartPlanRecommendationSelection {
  providerId?: string;
  modelId?: string;
  options?: Record<string, unknown>;
}

export function useStartPlanRecommendation(
  _modelSelectionView?: unknown,
  _scope?: string,
): <T extends StartPlanRecommendationSelection | undefined | null>(
  selection: T,
) => Promise<T> {
  void _modelSelectionView;
  void _scope;
  return async <T extends StartPlanRecommendationSelection | undefined | null>(
    selection: T,
  ): Promise<T> => selection;
}
