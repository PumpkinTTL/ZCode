/**
 * 模块级「按 key 记忆展开态」存储。
 *
 * 这类记忆跨组件卸载存活（收起再展开、切 tab 再回来都还在），但 key 通常按
 * toolId / 卡片 id 生成、只增不减。长会话里会慢性累积，所以统一带 FIFO 上限：
 * 超出后在插入新 key 时淘汰最老的一条，被遗忘的 key 回落调用方默认值。
 */
export interface BoundedOpenStateStore {
  get(key: string): boolean | undefined;
  set(key: string, open: boolean): void;
  size(): number;
  clear(): void;
}

export function createBoundedOpenStateStore(cap: number): BoundedOpenStateStore {
  const state = new Map<string, boolean>();
  return {
    get(key) {
      return state.get(key);
    },
    set(key, open) {
      // 更新已有 key 不改变插入顺序、也不触发淘汰；只在插入新 key 且已达上限时淘汰最老的。
      if (!state.has(key) && state.size >= cap) {
        const oldest = state.keys().next().value;
        if (oldest !== undefined) state.delete(oldest);
      }
      state.set(key, open);
    },
    size() {
      return state.size;
    },
    clear() {
      state.clear();
    },
  };
}
