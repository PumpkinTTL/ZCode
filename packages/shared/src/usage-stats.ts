/* eslint-disable max-lines -- Usage 与 Entitlement 的跨进程协议需要共享同一组 Account Access 字段和运行时 schema，暂时集中维护。 */
import { z } from "zod";

// 额度类型拆在 usage-quota.ts，见该文件头部说明；这里 re-export 保持既有 import 路径不变。
export * from "./usage-quota.js";
import type { UsageMcpQuotaSnapshot, UsageQuotaSnapshot } from "./usage-quota.js";
import type { ZCodeAccountAccess, ZCodeProviderAccountAccess } from "./zcode-protocol/index.js";

export interface UsageEntitlementRequest {
  /** 购买或领取完成后，使对应 Start Plan balance 短期缓存失效。 */
  invalidateBalanceCache?: boolean;
  /** 兼容旧调用方的提示；Coding Plan 权益必须查询订阅并返回摘要，不再允许仅用额度推断权益。 */
  includeSubscription?: boolean;
  /** 聊天输入区可传入当前选中的内置供应商,确保 BigModel/Z.AI 用量跟随模型选择。 */
  preferredProviderId?: string;
  /** 指定 Account Provider 的静态访问类别，或调用边界已解析的动态账号访问上下文。 */
  accountAccess?: ZCodeProviderAccountAccess | ZCodeAccountAccess;
  /** 当前模型已明确选中该内置供应商时，即使供应商列表里被隐藏也允许读取其 key。 */
  allowDisabledPreferredProvider?: boolean;
  /** 指定来源的场景必须命中 preferredProviderId,否则不允许回退到其它 provider。 */
  requirePreferredProvider?: boolean;
  /** 是否允许 host 环境变量覆盖 provider key。默认允许,显式 provider 场景可关闭。 */
  allowEnvApiKey?: boolean;
}

export interface UsageEntitlementSnapshot {
  generatedAt: number;
  /** 当前额度响应的服务端时间（毫秒）；与本地快照生成时间 generatedAt 分离。 */
  serverTime?: number;
  authenticated: boolean;
  unavailableReason?: "not_authenticated" | "not_configured" | "no_plan" | "unavailable";
  /** 无可用 Start Plan 时，保留明确过期原因用于展示。 */
  startPlanExpired?: boolean;
  /** 团队订阅明确失效的原因，仅与 no_plan 一起返回。 */
  teamPlanUnavailableReason?: "expired" | "unassigned";
  /** 当前 entitlement 查询对应的个人 / 团队上下文，用于设置页连接方式主判定。 */
  context?: UsageEntitlementContext | null;
  /** 当前用于查询 quota 的模型供应商信息。 */
  provider: UsageEntitlementProviderInfo | null;
  remaining: UsageEntitlementRemaining | null;
  subscription: UsageEntitlementSubscription | null;
  quota: UsageQuotaSnapshot | null;
  /**
   * ZCode 官方 Server MCP 的调用额度（`/api/v1/mcp/usage`）。
   * 与 quota 同一份快照下发，是为了继承 entitlement 已有的缓存 / in-flight 合并 / TTL 策略；
   * 拉取失败、未开通 Coding Plan、或该额度不属于本次查询的连接时一律为 null（可选数据面）。
   */
  mcpQuota?: UsageMcpQuotaSnapshot | null;
}

export interface UsageEntitlementContext {
  scope: "personal" | "team";
  organizationId?: string | null;
  projectId?: string | null;
  displayName?: string | null;
  productId?: string | null;
}

export type PlanIdentityStatus = "coding_plan" | "start_plan" | "no_plan" | "unknown";

export interface PlanIdentitySnapshot {
  generatedAt: number;
  planStatus: PlanIdentityStatus;
  planProductId: string;
}

export interface UsageEntitlementRemaining {
  count: number;
  isShow: boolean;
  percentage?: number;
  nextResetTime?: number | null;
}

export interface UsageEntitlementProviderInfo {
  id: string;
  name: string;
}

export interface UsageEntitlementSubscription {
  identityType: "email" | "phoneNumber" | "unknown";
  identityMasked: string | null;
  details: UsageEntitlementSubscriptionDetail[];
}

export interface UsageEntitlementSubscriptionDetail {
  productId: string;
  productName: string;
  purchaseTime: string | null;
  beginTime: string | null;
  billingCycle?: string | null;
  renewTime?: string | null;
  expireTime: string | null;
  /** Start Plan balance 套餐下的权益生效时间；其他订阅类型可不提供。 */
  entitlements?: Array<{
    entitlementId: string;
    /** 服务端 entitlement show_name，用于待生效提示。 */
    showName?: string | null;
    effectiveTime: string | null;
  }>;
}

// ── App Usage（agent 数据库真实统计）────────────────────────────────
export const APP_USAGE_RANGES = ["all", "7d", "30d"] as const;
export type AppUsageRange = (typeof APP_USAGE_RANGES)[number];

export const appUsageFavoriteModelSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
  share: z.number(),
});

export const appUsageSummarySchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheHitRate: z.number(),
  totalSessions: z.number(),
  totalTurns: z.number(),
  toolCallCount: z.number(),
  toolErrorRate: z.number(),
  modelErrorRate: z.number(),
  avgTimeToFirstTokenMs: z.number().nullable(),
  avgTurnDurationMs: z.number().nullable(),
  activeDays: z.number(),
  currentStreakDays: z.number(),
  longestSessionMs: z.number(),
  longestStreakDays: z.number(),
  peakDayTokens: z.number(),
  favoriteModel: appUsageFavoriteModelSchema.nullable(),
});

export const appUsageHeatmapCellSchema = z.object({
  date: z.string(),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  totalTokens: z.number(),
  turnCount: z.number(),
  toolCallCount: z.number(),
});

export const appUsageHeatmapWeekSchema = z.object({
  weekIndex: z.number(),
  days: z.array(appUsageHeatmapCellSchema.nullable()),
});

export const appUsageHeatmapSchema = z.object({
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  maxTokens: z.number(),
  weeks: z.array(appUsageHeatmapWeekSchema),
});

export const appUsageDailyModelItemSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
});

export const appUsageDailyModelUsageSchema = z.object({
  date: z.string(),
  models: z.array(appUsageDailyModelItemSchema),
});

export const appUsageModelUsageSchema = z.object({
  modelId: z.string().nullable(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  requestCount: z.number(),
  share: z.number(),
});

export const appUsageToolUsageSchema = z.object({
  toolName: z.string(),
  callCount: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  avgDurationMs: z.number().nullable(),
});

export const appUsageSnapshotSchema = z.object({
  range: z.enum(APP_USAGE_RANGES),
  generatedAt: z.number(),
  timeZone: z.string(),
  source: z.literal("agent-db"),
  summary: appUsageSummarySchema,
  heatmap: appUsageHeatmapSchema,
  dailyModelUsage: z.array(appUsageDailyModelUsageSchema),
  models: z.array(appUsageModelUsageSchema),
  tools: z.array(appUsageToolUsageSchema),
});

export type AppUsageSummary = z.infer<typeof appUsageSummarySchema>;
export type AppUsageHeatmapCell = z.infer<typeof appUsageHeatmapCellSchema>;
export type AppUsageHeatmapWeek = z.infer<typeof appUsageHeatmapWeekSchema>;
export type AppUsageHeatmap = z.infer<typeof appUsageHeatmapSchema>;
export type AppUsageDailyModelItem = z.infer<typeof appUsageDailyModelItemSchema>;
export type AppUsageDailyModelUsage = z.infer<typeof appUsageDailyModelUsageSchema>;
export type AppUsageModelUsage = z.infer<typeof appUsageModelUsageSchema>;
export type AppUsageToolUsage = z.infer<typeof appUsageToolUsageSchema>;
export type AppUsageFavoriteModel = z.infer<typeof appUsageFavoriteModelSchema>;
export type AppUsageSnapshot = z.infer<typeof appUsageSnapshotSchema>;

export interface AppUsageRequest {
  range: AppUsageRange;
  timeZone?: string;
}

/** 粗略 token 估算：core 的 compact/上下文估算共用此除数（活常量，勿删）。 */
export const ESTIMATED_TOKEN_CHAR_DIVISOR = 3;

