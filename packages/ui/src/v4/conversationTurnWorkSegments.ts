import type {
  AssistantTextRow,
  ConversationRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
// Bugfix：必须直接引用纯函数模块，不能走 `@/plugin-ui/index.js` 桶文件。本文件在分享只读
// 时间线闭包里，桶文件会把 plugin-ui 全量组件 → V4ConversationContext → @zcode/services →
// @zcode/provider 拖进 web-share 构建，导致 `@zcode/shared/mcp-apps` 等子路径无法解析、构建失败。
import {
  isPluginUiPinnedToolRow,
  type PluginUiRowPinResolver,
} from "@/plugin-ui/domain/pluginUiRowPolicy.js";
import { buildConversationFlowItems } from "@/v4/conversationTurnFlowItems.js";
import type { AssistantWorkRow, ConversationTurnFlowItem } from "@/v4/conversationTurnFlowItems.js";

export interface ConversationTurnWorkStatus {
  state: "running" | "completed" | "interrupted";
  durationMs?: number;
  /**
   * 运行中且协议还没有 activeMs/endedAt 事实时的起点锚：叶子组件用它配合共享
   * 秒级时钟自行推进“工作中 N 秒”，renderUnits 因此不必每秒全量重建。
   */
  startedAt?: number;
}

export interface ConversationTurnWorkSegment {
  key: string;
  triggerRow?: UserInputRow;
  flowItems: ConversationTurnFlowItem[];
  assistantWorkRows: AssistantWorkRow[];
  assistantHistoryRows: AssistantWorkRow[];
  assistantFollowingRows: AssistantWorkRow[];
  assistantHistoryDefaultOpen: boolean;
  workStatus?: ConversationTurnWorkStatus;
}

export function resolveConversationTurnWorkStatus(
  header: TurnHeaderRow | undefined,
  workRows: readonly AssistantWorkRow[],
  isRunning: boolean,
  durationMs: number | undefined,
  isInterrupted = false,
  startedAt?: number,
): ConversationTurnWorkStatus | undefined {
  if (header?.executionKind === "controlOnly") return undefined;
  const hasWork =
    isRunning ||
    workRows.length > 0 ||
    (header?.executionKind === "agent" ? durationMs !== undefined : (durationMs ?? 0) > 0);
  if (!hasWork) return undefined;
  const runningStartedAt = startedAt ?? header?.startedAt;
  return {
    state: isRunning ? "running" : isInterrupted ? "interrupted" : "completed",
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(isRunning && runningStartedAt !== undefined ? { startedAt: runningStartedAt } : {}),
  };
}

export function resolveConversationTurnWorkDurationMs(
  header: TurnHeaderRow | undefined,
): number | undefined {
  if (!header) return undefined;
  if (header.activeMs !== undefined) return header.activeMs;
  if (header.endedAt !== undefined) return Math.max(header.endedAt - header.startedAt, 0);
  // 运行中且没有 activeMs/endedAt 时不下发时长：起点锚(startedAt)已随 workStatus
  // 下发，叶子组件用共享秒级时钟推进“工作中 N 秒”。不能在这里吃当前时钟——
  // 那会让 renderUnits 依赖每秒 tick 全量重建，历史“已工作”也会随时间增长。
  return undefined;
}

interface DraftVisualWorkSegment {
  orderedRows: ConversationRow[];
  triggerRow?: UserInputRow;
}

function isUserInputRow(row: ConversationRow): row is UserInputRow {
  return row.kind === "userInput";
}

function isAssistantTextRow(row: ConversationRow): row is AssistantTextRow {
  return row.kind === "assistantText";
}

function isAssistantWorkRow(row: ConversationRow): row is AssistantWorkRow {
  return row.kind !== "turnHeader" && row.kind !== "userInput";
}

function isGuidedUserInputRow(row: ConversationRow | undefined): row is UserInputRow {
  return row !== undefined && isUserInputRow(row) && row.guided === true;
}

function splitVisualWorkSegments(
  rows: readonly ConversationRow[],
  header: TurnHeaderRow | undefined,
): DraftVisualWorkSegment[] {
  // 工作段边界只认 CLI 下发的 workSegments：哪几条 guide 是同一次取出，只有 CLI 知道。
  // 修复原因：原来每条 guided user 都开一段，与 CLI 每条 guide 一段的分段一致。runtime 改为一个边界
  // 按 FIFO 取出全部已等待的 guide 后，逐条切分会把一次取出拆成多段；这里只在 CLI 声明的段首切分。
  // 没有 workSegments 的旧快照才回退：上一行已是 guided user 时并入当前段。
  const triggerEntityIds = header?.workSegments
    ? new Set(header.workSegments.flatMap((segment) => segment.triggerEntityId ?? []))
    : undefined;
  const segments: DraftVisualWorkSegment[] = [];
  let current: DraftVisualWorkSegment = { orderedRows: [] };
  for (const row of rows) {
    const opensSegment =
      isUserInputRow(row) &&
      (triggerEntityIds
        ? row.entityId !== undefined && triggerEntityIds.has(row.entityId)
        : row.guided === true && !isGuidedUserInputRow(current.orderedRows.at(-1)));
    if (opensSegment && current.orderedRows.length > 0) {
      segments.push(current);
      current = { orderedRows: [], triggerRow: row };
    }
    current.orderedRows.push(row);
  }
  if (current.orderedRows.length > 0) segments.push(current);
  return segments;
}

interface SegmentWorkTiming {
  durationMs?: number;
  /** 运行中且缺协议事实时给叶子的起点锚（优先级与 durationMs 的解析一致）。 */
  startedAt?: number;
}

function resolveSegmentTiming(options: {
  header?: TurnHeaderRow;
  segmentIndex: number;
  triggerRow?: UserInputRow;
  nextTriggerRow?: UserInputRow;
  segmentRunning: boolean;
  segmentCount: number;
}): SegmentWorkTiming {
  const fact =
    (options.triggerRow?.entityId
      ? options.header?.workSegments?.find(
          (candidate) => candidate.triggerEntityId === options.triggerRow?.entityId,
        )
      : undefined) ?? options.header?.workSegments?.[options.segmentIndex];
  if (fact?.activeMs !== undefined) return { durationMs: fact.activeMs };
  if (fact?.endedAt !== undefined)
    return { durationMs: Math.max(0, fact.endedAt - fact.startedAt) };
  if (fact && options.segmentRunning) return { startedAt: fact.startedAt };
  if (options.segmentCount === 1) {
    const header = options.header;
    if (!header) return {};
    if (header.activeMs !== undefined) return { durationMs: header.activeMs };
    if (header.endedAt !== undefined)
      return { durationMs: Math.max(header.endedAt - header.startedAt, 0) };
    if (options.segmentRunning) return { startedAt: header.startedAt };
    return {};
  }
  // 兼容旧 guide snapshot：新 CLI 会下发 workSegments；仅旧数据缺事实时才按
  // guided row 的稳定时间边界恢复，避免刷新后又退回整个 turn 的单一工时。
  const startedAt = options.triggerRow?.createdAt ?? options.header?.startedAt;
  const endedAt = options.nextTriggerRow?.createdAt ?? options.header?.endedAt;
  if (startedAt !== undefined && endedAt !== undefined)
    return { durationMs: Math.max(0, endedAt - startedAt) };
  if (startedAt !== undefined && options.segmentRunning) return { startedAt };
  return {};
}

export function buildConversationTurnWorkSegments(options: {
  key: string;
  header?: TurnHeaderRow;
  orderedRows: readonly ConversationRow[];
  assistantTailRows: readonly AssistantWorkRow[];
  latestAssistantTextRow?: AssistantTextRow;
  isRunning: boolean;
  isLastTurn: boolean;
  isInterrupted: boolean;
  forceOpenHistory: boolean;
  timelineOnly: boolean;
  /** 插件卡片进不进折叠区的裁决；缺省沿用"全部常驻"。 */
  pluginUiPinResolver?: PluginUiRowPinResolver;
}): ConversationTurnWorkSegment[] {
  const visualDrafts = splitVisualWorkSegments(options.orderedRows, options.header);
  const tailRowIds = new Set(options.assistantTailRows.map((row) => row.rowId));
  return visualDrafts.map((segment, segmentIndex) => {
    const segmentAssistantRows = segment.orderedRows.filter(isAssistantWorkRow);
    const segmentTailRows = segmentAssistantRows.filter((row) => tailRowIds.has(row.rowId));
    const segmentFlowRows = segmentAssistantRows.filter((row) => !tailRowIds.has(row.rowId));
    const lastSegmentFlowRow = segmentFlowRows.at(-1);
    const segmentCompleted = segmentIndex < visualDrafts.length - 1 || !options.isRunning;
    const productLatestAssistantTextRow = options.latestAssistantTextRow
      ? segmentFlowRows.find((row) => row.rowId === options.latestAssistantTextRow?.rowId)
      : undefined;
    const visibleAssistantTextRow =
      productLatestAssistantTextRow && isAssistantTextRow(productLatestAssistantTextRow)
        ? productLatestAssistantTextRow
        : segmentCompleted && lastSegmentFlowRow && isAssistantTextRow(lastSegmentFlowRow)
          ? lastSegmentFlowRow
          : undefined;
    const visibleAssistantIndex = visibleAssistantTextRow
      ? segmentFlowRows.findIndex((row) => row.rowId === visibleAssistantTextRow.rowId)
      : -1;
    // 插件 UI 工具行留在折叠区外（与 assistantText 同级），过程行照常折叠；见 isPluginUiPinnedToolRow。
    const segmentHistoryRows = (
      options.timelineOnly
        ? []
        : visibleAssistantIndex < 0
          ? segmentFlowRows
          : segmentFlowRows.slice(0, visibleAssistantIndex)
    ).filter((row) => !isPluginUiPinnedToolRow(row, options.pluginUiPinResolver));
    const segmentFollowingRows =
      visibleAssistantIndex < 0 ? [] : segmentFlowRows.slice(visibleAssistantIndex + 1);
    const segmentRunning = segmentIndex === visualDrafts.length - 1 && options.isRunning;
    const segmentTiming = resolveSegmentTiming({
      header: options.header,
      segmentIndex,
      triggerRow: segment.triggerRow,
      nextTriggerRow: visualDrafts[segmentIndex + 1]?.triggerRow,
      segmentRunning,
      segmentCount: visualDrafts.length,
    });
    const segmentWorkStatus = resolveConversationTurnWorkStatus(
      options.header,
      segmentFlowRows,
      segmentRunning,
      segmentTiming.durationMs,
      options.isInterrupted && segmentIndex === visualDrafts.length - 1,
      segmentTiming.startedAt,
    );
    const segmentKey =
      segmentIndex === 0
        ? options.key
        : `${options.key}:guide:${segment.triggerRow?.entityId ?? segment.triggerRow?.rowId ?? segmentIndex}`;
    const flowItems = buildConversationFlowItems({
      orderedRows: segment.orderedRows,
      assistantHistoryRows: segmentHistoryRows,
      assistantFollowingRows: segmentFollowingRows,
      assistantTailRows: segmentTailRows,
      ...(visibleAssistantTextRow ? { visibleAssistantTextRow } : {}),
      ...(options.latestAssistantTextRow
        ? { latestAssistantTextRow: options.latestAssistantTextRow }
        : {}),
      timelineOnly: options.timelineOnly,
    });
    return {
      key: segmentKey,
      ...(segment.triggerRow ? { triggerRow: segment.triggerRow } : {}),
      flowItems,
      assistantWorkRows: segmentAssistantRows,
      assistantHistoryRows: segmentHistoryRows,
      assistantFollowingRows: segmentFollowingRows,
      assistantHistoryDefaultOpen:
        !options.timelineOnly &&
        (options.forceOpenHistory ||
          (options.isLastTurn && segmentWorkStatus?.state === "running") ||
          (visualDrafts.length === 1 &&
            visibleAssistantTextRow === undefined &&
            segmentFlowRows.length > 0)),
      ...(segmentWorkStatus ? { workStatus: segmentWorkStatus } : {}),
    };
  });
}
