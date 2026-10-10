// renderUnits 的跨帧增量构建：与 buildConversationTurnRenderUnits 输出逐字节一致。
// 独立成模块只因基文件已到 oxlint max-lines 上限；语义上它是同一纯函数的缓存化版本。
import type {
  ConversationRow,
  HookInvocationRow,
  SessionPhase,
  TurnHeaderRow,
} from "@zcode/shared/zcode-protocol-v4";
import type { PluginUiRowPinResolver } from "@/plugin-ui/index.js";
import {
  groupRowsIntoDrafts,
  materializeDraftUnit,
  normalizeRenderUnitPosition,
  shouldKeepRenderUnit,
  type BuildConversationTurnRenderUnitsOptions,
  type ConversationTurnRenderUnit,
  type DraftTurnRenderUnit,
} from "@/v4/conversationTurnRenderUnits.js";

/**
 * 跨帧增量缓存的每轮条目：签名（header/rows 引用数组/是否末轮/options 字段）完全
 * 决定 materializeDraftUnit 的输出，签名未变即可复用上一帧的 unit 引用。
 */
interface CachedTurnRenderUnit {
  header: TurnHeaderRow | undefined;
  orderedRows: readonly ConversationRow[];
  hookInvocations: readonly HookInvocationRow[];
  isLastDraft: boolean;
  sessionPhase: SessionPhase | undefined;
  pluginUiPinResolver: PluginUiRowPinResolver | undefined;
  unit: ConversationTurnRenderUnit;
}

/** 每个时间线实例持有一份；实例内部不并发，直接可变更新。 */
export interface ConversationTurnRenderUnitsCache {
  byTurnId: Map<string, CachedTurnRenderUnit>;
}

export function createConversationTurnRenderUnitsCache(): ConversationTurnRenderUnitsCache {
  return { byTurnId: new Map() };
}

function sameReferenceArray<T>(cached: readonly T[], next: readonly T[]): boolean {
  if (cached.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (cached[index] !== next[index]) return false;
  }
  return true;
}

function cachedTurnSignatureMatches(
  cached: CachedTurnRenderUnit,
  draft: DraftTurnRenderUnit,
  isLastDraft: boolean,
  options: BuildConversationTurnRenderUnitsOptions,
): boolean {
  if (cached.header !== draft.header) return false;
  if (cached.isLastDraft !== isLastDraft) return false;
  if (cached.sessionPhase !== options.sessionPhase) return false;
  if (cached.pluginUiPinResolver !== options.pluginUiPinResolver) return false;
  return (
    sameReferenceArray(cached.orderedRows, draft.orderedRows) &&
    sameReferenceArray(cached.hookInvocations, draft.hookInvocations)
  );
}

/**
 * 流式期间 rows 每帧变化，但几乎只影响运行中的最后一个 turn；同步版本每帧对
 * 全部历史 turn 重跑 materialize（多次 filter/Set/flatMap + workSegments 构建），
 * 长会话下是渲染主线程的最大每帧 O(N) 项。此版本按「turn 输入签名」复用未变
 * turn 的 materialize 结果：未变 turn 返回同一 unit 引用，还让下游
 * ConversationTurnGroup 的 memo 真正生效（跳过未变化 turn 的整棵子树协调）。
 *
 * 签名覆盖 materializeDraftUnit 的全部输入：draft.{header,userInputs,assistantWorkRows,
 * hookInvocations,orderedRows}（后四者皆 orderedRows/hookInvocations 的子集或派生）、
 * draft index/total（只通过 isLastDraft 影响）、options.{sessionPhase,pluginUiPinResolver}。
 */
export function buildConversationTurnRenderUnitsIncremental(
  rows: readonly ConversationRow[],
  options: BuildConversationTurnRenderUnitsOptions,
  cache: ConversationTurnRenderUnitsCache,
): ConversationTurnRenderUnit[] {
  const { drafts, lastTurnId } = groupRowsIntoDrafts(rows);
  // 每次构建整体重建缓存表：只在当前 drafts 里保留条目，陈旧轮次（rewind/换分支/
  // 换会话复用实例）自然被丢弃，缓存规模上界 = 当前轮次数。
  const nextCache = new Map<string, CachedTurnRenderUnit>();
  const materializedUnits = drafts.map((draft, index) => {
    const isLastDraft = draft.turnId === lastTurnId;
    const cached = cache.byTurnId.get(draft.turnId);
    const unit =
      cached && cachedTurnSignatureMatches(cached, draft, isLastDraft, options)
        ? cached.unit
        : materializeDraftUnit(draft, index, drafts.length, options);
    nextCache.set(draft.turnId, {
      header: draft.header,
      orderedRows: draft.orderedRows,
      hookInvocations: draft.hookInvocations,
      isLastDraft,
      sessionPhase: options.sessionPhase,
      pluginUiPinResolver: options.pluginUiPinResolver,
      unit,
    });
    return unit;
  });
  cache.byTurnId = nextCache;
  const keptUnits = materializedUnits.filter(shouldKeepRenderUnit);
  return keptUnits.map((unit, index) =>
    normalizeRenderUnitPosition(unit, index, keptUnits.length, options),
  );
}
