/**
 * StoreProvider —— 初始化 Zustand store 并通过 React Context 提供
 *
 * 在应用根部挂载，连接 broadcastService 实现跨窗口状态同步。
 */
import { useRef, type ReactNode } from "react";
import type { IBroadcastService } from "@zcode/services";
import { createZCodeStore, type ZCodeStore } from "./index.js";
import { StoreContext } from "./storeContext.js";

// Context 与 hook 放在无运行时依赖的 storeContext.ts，避免 HMR 重载本模块时换掉 Context 身份。
export { useZCodeStore, useZCodeStoreWithDefault } from "./storeContext.js";

export function StoreProvider({
  broadcastService,
  initialIsRestoringOAuthSession = false,
  children,
}: {
  broadcastService: IBroadcastService;
  initialIsRestoringOAuthSession?: boolean;
  children: ReactNode;
}) {
  // 只在首次渲染时创建 store，避免 HMR 重复订阅
  const storeRef = useRef<ZCodeStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createZCodeStore(broadcastService, {
      initialIsRestoringOAuthSession,
    });
  }

  return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>;
}
