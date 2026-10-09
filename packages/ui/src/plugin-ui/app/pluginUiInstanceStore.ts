import {
  EMPTY_PLUGIN_UI_INSTANCE_DERIVATION,
  type PluginUiInstanceDerivation,
  type PluginUiRowDisposition,
} from "../domain/pluginUiInstancePolicy.js";

/**
 * 每个会话最近一次由时间线推导出的逻辑 UI 裁决（renderer 内存）。时间线在 effect 里写入，
 * 工具卡片按 (sessionKey, toolCallId) 读自己的裁决（是否被替代、是否强制常驻）；不持有任何沙箱状态。
 *
 * 派生对象持有 rows 的投影引用，按 sessionKey 只增不减会长期钉住历史会话的行数据。
 * FIFO 封顶：超限淘汰最旧会话；被淘汰的会话再次打开时时间线 effect 会重新推导发布，自愈。
 */
const MAX_PLUGIN_UI_DERIVATION_SESSIONS = 12;
const derivations = new Map<string, PluginUiInstanceDerivation>();
const listeners = new Set<() => void>();

export function setPluginUiInstanceDerivation(
  sessionKey: string,
  derivation: PluginUiInstanceDerivation,
): void {
  if (derivations.get(sessionKey) === derivation) return;
  // 删了重插保持 FIFO 语义：最近写入的会话沉底，最旧的在队首被淘汰。
  derivations.delete(sessionKey);
  derivations.set(sessionKey, derivation);
  while (derivations.size > MAX_PLUGIN_UI_DERIVATION_SESSIONS) {
    const oldestKey = derivations.keys().next().value;
    if (oldestKey === undefined) break;
    derivations.delete(oldestKey);
  }
  for (const listener of listeners) listener();
}

export function getPluginUiRowDisposition(
  sessionKey: string,
  toolCallId: string,
): PluginUiRowDisposition | undefined {
  return (derivations.get(sessionKey) ?? EMPTY_PLUGIN_UI_INSTANCE_DERIVATION).byToolCallId[
    toolCallId
  ];
}

export function subscribePluginUiInstances(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 测试用：清空全部记录。 */
export function resetPluginUiInstancesForTest(): void {
  derivations.clear();
  listeners.clear();
}
