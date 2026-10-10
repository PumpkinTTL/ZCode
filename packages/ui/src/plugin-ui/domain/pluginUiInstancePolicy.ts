import type { ConversationRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import { resolvePluginUiLogicalScope } from "./pluginUiLogicalScope.js";

/** ：最近几个回合的插件卡片默认展开，更早的按默认收进折叠区。 */
export const PLUGIN_UI_AUTO_EXPAND_TURNS = 3;

/** 一个逻辑 UI：仅显式 surface 或权限范围一致的 widgetSessionId 共用，其余调用独立。 */
export interface PluginUiLogicalInstance {
  key: string;
  /** 当前显示的调用：最新一次成功（非 isError）的；没有成功的就是最新一条。 */
  activeToolCallId: string;
  /** 被较新成功结果替代的成功调用；它们不建沙箱，只保留普通工具记录。 */
  supersededToolCallIds: string[];
}

/** 单条插件工具行的展示裁决；渲染层据此决定进不进折叠区、要不要建沙箱。 */
export interface PluginUiRowDisposition {
  key: string;
  superseded: boolean;
  /** 所在回合在最近 PLUGIN_UI_AUTO_EXPAND_TURNS 个回合内。 */
  autoExpand: boolean;
  /** 工具级 `openai/widgetShowCodexWidgetInline`（display.ui.showInline）。 */
  forcedInline: boolean;
}

export interface PluginUiInstanceDerivation {
  instances: PluginUiLogicalInstance[];
  byToolCallId: Readonly<Record<string, PluginUiRowDisposition>>;
}

export const EMPTY_PLUGIN_UI_INSTANCE_DERIVATION: PluginUiInstanceDerivation = {
  instances: [],
  byToolCallId: {},
};

function isPluginUiToolRow(row: ConversationRow): row is ToolCallRow {
  return (
    row.kind === "toolCall" && row.display?.kind === "mcp_tool" && row.display.ui !== undefined
  );
}

function isSuccessfulUiRow(row: ToolCallRow): boolean {
  return (
    row.status === "success" &&
    !(row.display?.kind === "mcp_tool" && row.display.ui?.isError === true)
  );
}

/**
 * 纯函数：从投影行推导逻辑 UI 实例与每行的展示裁决（V-a）。
 * key 同时绑定来源、server、资源、权限与逻辑视图；同 key 内最新一次成功结果替代更早的成功结果，
 * running / failed / isError 的行既不替代别人也不被替代（各自显示自己的状态）。
 * autoExpand 按全部行的回合顺序取最近 N 个回合（回合里没有插件卡片也算一个回合）。
 */
export function deriveLogicalUiInstances(
  rows: readonly ConversationRow[],
  options: { autoExpandTurns?: number } = {},
): PluginUiInstanceDerivation {
  // domain 不用 Map / Set（模块边界约束），全部用数组与普通对象。
  // includes 去重是 O(rows×turns)，长会话每帧全量重算会退化成 O(N²)；
  // 普通对象当集合用（Object.create(null) 防原型键碰撞）降为 O(rows)。
  const turnOrder: string[] = [];
  const seenTurnIds: Record<string, true> = Object.create(null);
  for (const row of rows) {
    if (seenTurnIds[row.turnId] === true) continue;
    seenTurnIds[row.turnId] = true;
    turnOrder.push(row.turnId);
  }
  const recentTurns = turnOrder.slice(-(options.autoExpandTurns ?? PLUGIN_UI_AUTO_EXPAND_TURNS));
  const groupKeys: string[] = [];
  const groups: Record<string, ToolCallRow[]> = {};
  for (const row of rows) {
    if (!isPluginUiToolRow(row)) continue;
    const display = row.display;
    if (display?.kind !== "mcp_tool" || !display.ui) continue;
    const logical = resolvePluginUiLogicalScope(display.ui, {
      kind: "toolCall",
      toolCallId: row.toolCallId,
    });
    const key = JSON.stringify([
      display.ui.pluginId,
      display.serverName,
      display.ui.resourceUri,
      logical,
    ]);
    const group = groups[key];
    if (group) group.push(row);
    else {
      groups[key] = [row];
      groupKeys.push(key);
    }
  }
  const instances: PluginUiLogicalInstance[] = [];
  const byToolCallId: Record<string, PluginUiRowDisposition> = {};
  for (const key of groupKeys) {
    const group = groups[key]!;
    const successes = group.filter(isSuccessfulUiRow);
    const active = successes.at(-1) ?? group.at(-1)!;
    const superseded = successes.filter((row) => row !== active).map((row) => row.toolCallId);
    instances.push({ key, activeToolCallId: active.toolCallId, supersededToolCallIds: superseded });
    for (const row of group) {
      byToolCallId[row.toolCallId] = {
        key,
        superseded: superseded.includes(row.toolCallId),
        autoExpand: recentTurns.includes(row.turnId),
        forcedInline: row.display?.kind === "mcp_tool" && row.display.ui?.showInline === true,
      };
    }
  }
  return { instances, byToolCallId };
}

/**
 * 内容等价比较：流式期间 rows 每帧变化，但推导结果绝大多数帧逐字段相同。
 * 调用方用它复用上一次推导的引用，让依赖推导身份的下游 memo（pinResolver、
 * renderUnits 增量缓存）不被无关行的变化无效化。纯函数、不含 Map/Set（模块边界约束）。
 */
export function pluginUiInstanceDerivationsEqual(
  previous: PluginUiInstanceDerivation,
  next: PluginUiInstanceDerivation,
): boolean {
  if (previous === next) return true;
  const previousInstances = previous.instances;
  const nextInstances = next.instances;
  if (previousInstances.length !== nextInstances.length) return false;
  for (let index = 0; index < nextInstances.length; index += 1) {
    const a = previousInstances[index]!;
    const b = nextInstances[index]!;
    if (
      a.key !== b.key ||
      a.activeToolCallId !== b.activeToolCallId ||
      a.supersededToolCallIds.length !== b.supersededToolCallIds.length
    ) {
      return false;
    }
    for (let slot = 0; slot < b.supersededToolCallIds.length; slot += 1) {
      if (a.supersededToolCallIds[slot] !== b.supersededToolCallIds[slot]) return false;
    }
  }
  const previousKeys = Object.keys(previous.byToolCallId);
  const nextKeys = Object.keys(next.byToolCallId);
  if (previousKeys.length !== nextKeys.length) return false;
  for (const toolCallId of nextKeys) {
    const a = previous.byToolCallId[toolCallId];
    const b = next.byToolCallId[toolCallId];
    if (a === undefined || b === undefined) return false;
    if (
      a.key !== b.key ||
      a.superseded !== b.superseded ||
      a.autoExpand !== b.autoExpand ||
      a.forcedInline !== b.forcedInline
    ) {
      return false;
    }
  }
  return true;
}
