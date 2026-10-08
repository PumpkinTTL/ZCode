import type {
  AppUsageRequest,
  AppUsageSnapshot,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
} from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

/**
 * Polaris fork：官方 Coding Plan（z.ai / bigmodel）的配额、用量监控与重置链路已整体移除，
 * 对应的死接口（getCodingPlanUsageSnapshot / Coding Plan 重置 / 旧版 UsageStats 快照）
 * 已从 `IUsageStatsService` 一并删除。
 *
 * 唯一保留真实实现的是 `getAppUsageSnapshot`：它读的是本机 agent 数据库，与官方无关。
 * `getEntitlementSnapshot` 返回明确的「未配置」空态，供侧栏与设置页自然降级，
 * 待自有账号服务上线后在此处接回真实实现。
 */
export function createUsageStatsService(
  dependencies: Pick<IZCodeAgentService, "getAppUsageStats">,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回，不依赖任何官方端点。
      return dependencies.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
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
