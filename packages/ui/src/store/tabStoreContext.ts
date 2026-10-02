import { createContext } from "react";
// 仅类型导入：运行时不留依赖，避免 tabStore 实现变更时本模块被 HMR 失效。
import type { TabStore } from "./tabStore.js";

/**
 * TabStore Context 必须独立于 TabStoreProvider 组件模块。
 *
 * 与 store/storeContext.ts、i18n/intlContext.ts 同理：Context 与 Provider 同模块时，
 * Vite HMR 重载 Provider 会让 Context 换新身份，导致子级 hook 读到 null 并抛
 * 「必须在 TabStoreProvider 内使用」。本模块只依赖 react，不运行时依赖 tabStore 实现，
 * 因此 Context 身份在 HMR 中保持稳定。
 *
 * 消费 hook（useTabStore / useOptionalTabStore / useTabStoreApi）留在 TabStoreProvider.tsx，
 * 因为 useOptionalTabStore 需要一个运行时构造的 fallback store。
 */
export const TabStoreContext = createContext<TabStore | null>(null);
