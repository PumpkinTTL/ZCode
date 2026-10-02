import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
// 仅类型导入：运行时不留依赖，避免 store 实现文件变更时本模块被 HMR 失效。
import type { ZCodeStore, ZCodeState } from "./index.js";

/**
 * Store Context 与消费 hook 必须独立于 StoreProvider 组件模块。
 *
 * 与 i18n/intlContext.ts 同理：Vite HMR 重载 StoreProvider 模块时，若 Context 与
 * Provider 定义在同一模块，Context 对象会换新身份，已挂载的旧 Provider 子树读到
 * null，导致子级 useZCodeStore 抛「必须在 StoreProvider 内使用」。
 *
 * 本模块只依赖 react/zustand，不运行时依赖 "./index.js"（仅类型），因此 store 实现、
 * Provider 组件或 UI 文件的 HMR 都不会让这里的 Context 身份发生变化。
 */
export const StoreContext = createContext<ZCodeStore | null>(null);

/**
 * 消费 Zustand store 的 hook
 *
 * 用法：
 *   const theme = useZCodeStore(s => s.theme);
 *   const setTheme = useZCodeStore(s => s.setTheme);
 */
export function useZCodeStore<T>(selector: (state: ZCodeState) => T): T {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useZCodeStore 必须在 StoreProvider 内使用");
  }
  return useStore(store, selector);
}

/**
 * 带默认值的容错版 useZCodeStore（store 耦合剥离配套）。
 *
 * 使用场景：宿主组件（PermissionDialog / 各 markdown 弹窗等）负责从 store 取
 * theme / codePreviewSettings，再通过 props 注入纯展示组件。这些宿主在单测里常被
 * 无 Provider 直接 renderToStaticMarkup，此时返回 defaultValue 而不是抛错，
 * 与「展示组件不触 store」的约束保持一致；真实应用 Root 必挂 StoreProvider，走真实值。
 *
 * 注意：selector 返回值与 defaultValue 都必须引用稳定，否则会造成无限重渲染。
 */
export function useZCodeStoreWithDefault<T>(
  selector: (state: ZCodeState) => T,
  defaultValue: T,
): T {
  const store = useContext(StoreContext);
  const subscribe = useCallback(
    (onStoreChange: () => void) => (store ? store.subscribe(onStoreChange) : () => {}),
    [store],
  );
  const getSnapshot = () => (store ? selector(store.getState()) : defaultValue);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
