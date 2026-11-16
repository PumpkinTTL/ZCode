import { z } from "zod";
import { modelSelectionSchema, type ModelSelection } from "./model-selection.js";

/**
 * CLI 只透传命中规则的原因，不自行解释 provider 错误码。
 * Polaris：Highspeed 卡业务行为链已移除；此 schema 仅为上游协议字段的结构兼容保留。
 */
export const modelExecutionSelectionFallbackReasonSchema = z.enum([
  "highspeed_card_expired",
  "highspeed_request_failed",
  "highspeed_selection_unavailable",
]);

/** 文本与附件发送共用执行约束，凭据只属于单次执行，不进入 Session 配置。 */
export const modelExecutionSchema = z
  .object({
    memoryExtraction: z.literal("skip").optional(),
    selectionScope: z.literal("execution"),
    offPeak: z
      .object({
        executionId: z.string().min(1),
        ticketId: z.string().min(1),
        providerErrorCode: z.string().min(1),
      })
      .strict()
      .optional(),
    requestAuth: z
      .object({
        apiKey: z.string().min(1).optional(),
        apiKeyId: z.string().trim().min(1).optional(),
        accountScope: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        headers: z.record(z.string().min(1), z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    subagents: z
      .object({
        foregroundModel: z.literal("submission"),
        background: z.enum(["deny", "allow"]),
      })
      .strict()
      .optional(),
    /**
     * 本次执行的 Selection 失败时，同一 Turn 内退回原模型继续跑完，而不是让整轮失败。
     * Polaris：Highspeed 行为链已移除；此字段仅为上游协议结构兼容保留（无生产写入方）。
     */
    selectionFallback: z
      .object({
        providerId: z.string().min(1),
        rules: z
          .array(
            z
              .object({
                reason: modelExecutionSelectionFallbackReasonSchema,
                providerErrorCode: z.string().min(1).optional(),
              })
              .strict(),
          )
          .min(1),
        target: modelSelectionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModelExecution = z.infer<typeof modelExecutionSchema>;
export type ModelExecutionSelectionFallback = NonNullable<
  ModelExecution["selectionFallback"]
>;
export type ModelExecutionSelectionFallbackRule =
  ModelExecutionSelectionFallback["rules"][number];
export type ModelExecutionSelectionFallbackReason = z.infer<
  typeof modelExecutionSelectionFallbackReasonSchema
>;
