import { useSyncExternalStore } from "react";
import type { QuotaModelCatalogEntry, QuotaModelDisplayTag, QuotaModelPromo } from "@zcode/services";

/**
 * 官方（Nimbus）模型展示元数据的渲染层共享快照：模型选择器 / 设置页模型行渲染
 * 计费倍率、标签、限时折扣用。**纯展示**——不参与任何计费/能力/选择判定。
 *
 * 数据来源：/v1/models（登录态）或免登录 /app-updates/models，二者同一构建器。
 * 发布点：登录/同步开通（provisionNimbusProvider）与挂载时刷新
 * （business/quota/nimbusModelCatalogRefresh）。不做持久化：展示字段随目录拉取
 * 刷新，拉不到就整体不显示（宁缺毋错，避免陈旧折扣文案误导）。
 *
 * 键控防串台：快照带 providerId，读取必须 providerId 匹配——同一 modelId 字符串
 * 可能同时存在于其他供应商（本地自定义 provider），不能只看 modelId。
 */
export interface NimbusModelDisplayMeta {
  /** 组合计费倍率（如 0.5 = 半价）；未配置时 null。 */
  readonly multiplier: number | null;
  readonly tags: readonly QuotaModelDisplayTag[];
  readonly promo: QuotaModelPromo | null;
}

interface NimbusModelDisplayMetaSnapshot {
  readonly providerId: string | null;
  readonly byModelId: ReadonlyMap<string, NimbusModelDisplayMeta>;
  /** 最近一次成功发布时刻（毫秒）；0 = 从未发布。 */
  readonly publishedAt: number;
}

let snapshot: NimbusModelDisplayMetaSnapshot = {
  providerId: null,
  byModelId: new Map(),
  publishedAt: 0,
};
let version = 0;
const listeners = new Set<() => void>();

/**
 * 发布一份目录快照（整体替换）。没有任何展示字段的条目不入快照——查询侧
 * 命中即渲染，不需要为「无徽标」建条目。
 */
export function publishNimbusModelDisplayMeta(
  providerId: string,
  entries: readonly QuotaModelCatalogEntry[],
): void {
  const byModelId = new Map<string, NimbusModelDisplayMeta>();
  for (const entry of entries) {
    if (entry.multiplier === null && entry.tags.length === 0 && entry.promo === null) continue;
    byModelId.set(entry.id, {
      multiplier: entry.multiplier,
      tags: entry.tags,
      promo: entry.promo,
    });
  }
  snapshot = { providerId, byModelId, publishedAt: Date.now() };
  version += 1;
  // 通知集快照：循环中订阅方增删不得改变本次通知集合（同 nimbusAccountState）。
  // eslint-disable-next-line unicorn/no-useless-spread -- 见上：快照是刻意行为
  for (const listener of [...listeners]) listener();
}

export function getNimbusModelDisplayMetaSnapshot(): NimbusModelDisplayMetaSnapshot {
  return snapshot;
}

/** 读取某供应商某模型的展示元数据；providerId 不匹配或未发布时 undefined。 */
/** 该 providerId 是否是发布过展示元数据的官方（Nimbus）供应商。 */
export function isNimbusModelDisplayProvider(
  providerId: string | null | undefined,
): boolean {
  return Boolean(providerId) && providerId === snapshot.providerId;
}

export function getNimbusModelDisplayMeta(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): NimbusModelDisplayMeta | undefined {
  if (!providerId || !modelId || providerId !== snapshot.providerId) return undefined;
  return snapshot.byModelId.get(modelId);
}

export function subscribeNimbusModelDisplayMeta(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅版本号：发布后强制重渲染，渲染期用 getNimbusModelDisplayMeta 读最新快照。 */
export function useNimbusModelDisplayMetaVersion(): number {
  return useSyncExternalStore(
    subscribeNimbusModelDisplayMeta,
    () => version,
  );
}
