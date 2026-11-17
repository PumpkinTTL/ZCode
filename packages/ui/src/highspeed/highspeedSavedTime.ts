/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import type { CodingPlanRegularTpsRequest } from "@zcode/shared";
import type { IUsageStatsService } from "@zcode/services";

export interface HighspeedTimingMetricsForSavedTime {
  outputTokens: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
}

export function calculateHighspeedSavedDurationMs(params: {
  outputTokens: number;
  regularTps: number;
  highspeedTps: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
}): number  {
  return null as unknown as never;
}

/**
 * 统一把完成态的真实耗时拆分传入计算器，避免持久化前漏传拆分字段后静默回退到 20/80 估算。
 */
export function calculateHighspeedSavedDurationFromMetrics(
  metrics: HighspeedTimingMetricsForSavedTime,
  regularTps: number,
  highspeedTps: number,
): number  {
  return null as unknown as never;
}

export async function readHighspeedRegularTpsFromHealth(params: {
  usageStatsService: IUsageStatsService;
  preferredProviderId: string;
  /**
   * 当前 Coding Plan 的账号访问上下文。Provider 重构后请求期鉴权只能由它解析，
   * 缺失时 host 无法确定用哪个账号/团队项目查询，必定抛错。
   */
  accountAccess: CodingPlanRegularTpsRequest["accountAccess"];
  timeZone?: string;
}): Promise<number | undefined>  {
  return null as unknown as never;
}
