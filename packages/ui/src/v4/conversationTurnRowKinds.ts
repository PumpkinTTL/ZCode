/**
 * 会话轮 row 的种类判定与轮尾切分。
 *
 * 从 `conversationTurnRenderUnits.ts` 抽出：该文件此前越过 `max-lines`(400) 上限。
 * 这里只放「按 row.kind 归类」的纯判定，以及依赖它们的轮尾切分；
 * 轮级语义（running 推导、展开裁决）仍留在 renderUnits，避免边界混淆。
 */
import type {
  AssistantTextRow,
  ConversationRow,
  HookInvocationRow,
  TimelineMarkerRow,
  TurnHeaderRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import type { AssistantWorkRow } from "@/v4/conversationTurnFlowItems.js";

export function isAssistantTextRow(row: ConversationRow): row is AssistantTextRow {
  return row.kind === "assistantText";
}

export function isTurnHeaderRow(row: ConversationRow): row is TurnHeaderRow {
  return row.kind === "turnHeader";
}

export function isUserInputRow(row: ConversationRow): row is UserInputRow {
  return row.kind === "userInput";
}

export function isTimelineMarkerRow(row: ConversationRow): row is TimelineMarkerRow {
  return row.kind === "timelineMarker";
}

export function isHookInvocationRow(row: ConversationRow): row is HookInvocationRow {
  return row.kind === "hookInvocation";
}

export function isVisibleAssistantWorkRow(row: AssistantWorkRow): boolean {
  if (row.kind === "reasoning" && row.text.trim().length === 0) {
    // reasoning_start/reasoning_end 可能形成空的终态 block；只在共享
    // render-unit 边界裁掉它，避免 completed 状态绕过 streaming renderer 的空行过滤。
    return false;
  }
  // EnterPlanMode 只是内部模式切换边界，把它当普通工具放进“已工作”，
  // 会显示一条没有用户价值的“工具调用已执行”。只在 render unit 过滤，不改写协议投影，
  // 以保留 desktop continuous / web remote replayable 共用的运行态与恢复语义。
  return row.kind !== "toolCall" || row.toolName !== "EnterPlanMode";
}

export function isVisibleConversationRow(row: ConversationRow): boolean {
  if (isUserInputRow(row)) return true;
  if (isTurnHeaderRow(row)) return false;
  if (isHookInvocationRow(row)) return false;
  return isVisibleAssistantWorkRow(row);
}

// 落位语义（lane）由 CLI 投影裁决下发（UI 不得按 marker type 自行推断）。
// lane 缺省（不应发生）按 assistantWork 兜底——降级进折叠组，不丢行。
function isTurnEndingTimelineMarkerRow(row: AssistantWorkRow): row is TimelineMarkerRow {
  return row.kind === "timelineMarker" && row.lane === "turnTailBoundary";
}

/**
 * artifact 行是分享投影追加到轮尾的产出物（insertDiscoveredArtifacts 插在该
 * productTurn 最后一行之后），但它同样属于 AssistantWorkRow，会成为 flow 的最后一行。
 * 于是折叠锚点的兜底条件「最后一行是 assistantText」失效——公开投影禁止 actions，
 * 分享页只有这条兜底——最终答复被卷进「已工作」并整轮默认展开。
 *
 * 它是追加的产出物、不属于对话流，按轮尾处理即可；与 browserTurnEndRows 摘轮尾截图同理。
 * 注意不能改成「取 flow 里最后一条 assistantText」：那会把 CUA 响应中途的正文
 * 提升成最终答复，拆散同一个 assistantResponseId 的分组。
 */
function isTurnTrailingArtifactRow(row: AssistantWorkRow): boolean {
  return row.kind === "artifact";
}

export function splitTurnTailRows(rows: readonly AssistantWorkRow[]): {
  flowRows: AssistantWorkRow[];
  tailRows: AssistantWorkRow[];
} {
  let tailStart = rows.length;
  while (
    tailStart > 0 &&
    (isTurnEndingTimelineMarkerRow(rows[tailStart - 1]!) ||
      isTurnTrailingArtifactRow(rows[tailStart - 1]!))
  ) {
    tailStart -= 1;
  }
  return {
    flowRows: rows.slice(0, tailStart),
    tailRows: rows.slice(tailStart),
  };
}

export function isBrowserTurnEndRow(row: AssistantWorkRow): boolean {
  // 自动截图以完成态 tool row 持久化在最终正文之后，旧分组只把
  // timeline boundary 识别为轮尾，导致截图被搬进上方“已工作”折叠区而不可见。
  return (
    row.kind === "toolCall" &&
    row.display?.kind === "node_repl_images" &&
    row.display.source === "browser_turn_end"
  );
}

export function isLightBoundaryMarkerRow(row: AssistantWorkRow): row is TimelineMarkerRow {
  return row.kind === "timelineMarker" && row.lane === "lightBoundary";
}
