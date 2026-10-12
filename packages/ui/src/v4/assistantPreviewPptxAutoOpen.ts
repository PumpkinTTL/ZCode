import type { ConversationRow, SessionPhase } from "@zcode/shared/zcode-protocol-v4";

export interface AssistantPreviewPptxCompletedTurn {
  turnId: string;
  rowId: number;
  entityId?: string;
}

export interface AssistantPreviewPptxAutoOpenTarget {
  turnId: string;
  key: string;
}

export interface AssistantPreviewPptxAutoOpenGateState {
  scopeKey: string;
  armed: boolean;
}

interface AssistantPreviewPptxAutoOpenGateInput {
  enabled: boolean;
  scopeKey: string;
  logEpoch?: string;
  phase?: SessionPhase;
  completedTurn: AssistantPreviewPptxCompletedTurn | null;
}

export interface AssistantPreviewPptxAutoOpenGateResult {
  state: AssistantPreviewPptxAutoOpenGateState;
  /** undefined=保持当前 target；null=清空；object=发布新的完成态 target。 */
  target?: AssistantPreviewPptxAutoOpenTarget | null;
}

export function createAssistantPreviewPptxAutoOpenGateState(): AssistantPreviewPptxAutoOpenGateState {
  return { scopeKey: "", armed: false };
}

export function resolveLatestCompletedAssistantPreviewTurn(
  rows: readonly ConversationRow[],
): AssistantPreviewPptxCompletedTurn | null {
  // 流式期间本函数每帧被调用一次（SessionPane 的 gate effect）。此前的
  // `[...rows].reverse().find(...)` 每次调用都对整条行窗口做两次全量数组拷贝 + 翻转
  // （万行长会话 ≈ 每帧 4 万次引用搬运 + 双份临时数组），纯属 GC 压力；
  // 语义等价的倒序 for 循环零分配，且同样「取满足谓词的最后一行」。
  let latestHeader: Extract<ConversationRow, { kind: "turnHeader" }> | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "turnHeader") {
      latestHeader = row;
      break;
    }
  }
  if (!latestHeader || latestHeader.state !== "completedSuccess") {
    return null;
  }

  let latestAssistant: Extract<ConversationRow, { kind: "assistantText" }> | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind === "assistantText" && row.turnId === latestHeader.turnId) {
      latestAssistant = row;
      break;
    }
  }
  if (!latestAssistant || latestAssistant.state !== "complete") return null;

  return {
    turnId: latestAssistant.turnId,
    rowId: latestAssistant.rowId,
    ...(latestAssistant.entityId ? { entityId: latestAssistant.entityId } : {}),
  };
}

export function advanceAssistantPreviewPptxAutoOpenGate(
  previous: AssistantPreviewPptxAutoOpenGateState,
  input: AssistantPreviewPptxAutoOpenGateInput,
): AssistantPreviewPptxAutoOpenGateResult {
  const scopeChanged = previous.scopeKey !== input.scopeKey;
  const current = scopeChanged ? { scopeKey: input.scopeKey, armed: false } : previous;

  if (!input.enabled) {
    return {
      state: { scopeKey: input.scopeKey, armed: false },
      target: null,
    };
  }

  if (input.phase === "running") {
    return {
      state: { scopeKey: input.scopeKey, armed: true },
      target: null,
    };
  }

  if (input.phase !== "completedSuccess") {
    return {
      state: { scopeKey: input.scopeKey, armed: false },
      ...(scopeChanged || current.armed ? { target: null } : {}),
    };
  }

  // 冷恢复会直接落在 completedSuccess，但没有观察到本 renderer 的 running 边沿。
  // 只保留已武装但终态 assistant row 尚未到齐的状态，避免依赖 phase/row 到达顺序。
  if (!current.armed || !input.completedTurn) {
    return { state: current };
  }

  const target: AssistantPreviewPptxAutoOpenTarget = {
    turnId: input.completedTurn.turnId,
    key: JSON.stringify([
      input.scopeKey,
      input.logEpoch ?? "",
      input.completedTurn.turnId,
      input.completedTurn.rowId,
      input.completedTurn.entityId ?? "",
    ]),
  };
  return {
    state: { scopeKey: input.scopeKey, armed: false },
    target,
  };
}
