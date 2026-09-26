import type {
  AppUsageRequest,
  AppUsageSnapshot,
  CodingPlanUsageRequest,
  CodingPlanUsageSnapshot,
  CodingPlanResetOpportunityRequest,
  CodingPlanResetOpportunityResult,
  CodingPlanResetScopeRequest,
  CodingPlanResetStatusSnapshot,
  CodingPlanResetUseRequest,
  CodingPlanResetUseResult,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
  UsageStatsRequest,
  UsageStatsSnapshot,
} from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

/**
 * Polaris fork：官方 Coding Plan（z.ai / bigmodel）的配额、用量监控与重置链路已整体移除。
 *
 * 原先这里由 `BigModelUsageQuotaProvider`（含 monitor 拉取、mapper、订阅查询、Start Plan
 * 计费与重置机会）实现，会按 zai / bigmodel 账号发起真实业务请求。自有账号服务尚未就绪，
 * 这些实现连同其 3000 余行代码一并删除；接口（`IUsageStatsService`）保持不变，等自有服务
 * 上线后在此处接回。
 *
 * 唯一保留真实实现的是 `getAppUsageSnapshot`：它读的是本机 agent 数据库，与官方无关。
 */
export const CODING_PLAN_REMOVED_CODE = "coding_plan_removed";

interface UsageStatsServiceDependencies {
  /** App Usage 经 ZCode Protocol 读取 agent 数据库真实统计。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
}

/** 统一的「该能力已移除」错误；UI 侧按错误码识别并显示空态。 */
function codingPlanRemoved(): Error {
  return new Error(CODING_PLAN_REMOVED_CODE);
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回，不依赖任何官方端点。
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
    async getCodingPlanUsageSnapshot(
      _request: CodingPlanUsageRequest,
    ): Promise<CodingPlanUsageSnapshot> {
      throw codingPlanRemoved();
    },
    async getCodingPlanResetStatus(
      _request: CodingPlanResetScopeRequest,
    ): Promise<CodingPlanResetStatusSnapshot> {
      throw codingPlanRemoved();
    },
    async requestCodingPlanResetOpportunity(
      _request: CodingPlanResetOpportunityRequest,
    ): Promise<CodingPlanResetOpportunityResult> {
      throw codingPlanRemoved();
    },
    async useCodingPlanReset(
      _request: CodingPlanResetUseRequest,
    ): Promise<CodingPlanResetUseResult> {
      throw codingPlanRemoved();
    },
    async markCodingPlanResetHistoryRead(_request: CodingPlanResetScopeRequest): Promise<void> {
      throw codingPlanRemoved();
    },
    async getSnapshot(_request: UsageStatsRequest): Promise<UsageStatsSnapshot> {
      throw codingPlanRemoved();
    },
    async getEntitlementSnapshot(
      _request: UsageEntitlementRequest = {},
    ): Promise<UsageEntitlementSnapshot> {
      // 不抛错：额度查询是界面常驻请求，返回明确的「未配置」空态，
      // 让侧栏与设置页自然降级，而不是每次渲染都冒一条错误。
      return {
        generatedAt: Date.now(),
        authenticated: false,
        unavailableReason: "not_configured",
        provider: null,
        remaining: null,
        subscription: null,
        quota: null,
      };
    },
  };
}
