/**
 * Nimbus 登录态的渲染层共享状态（模块级快照 + 订阅 + 获焦重校验）。
 *
 * 为什么需要它：侧边栏底部（WorkspaceSidebarFooter）、设置页「我的额度」与账号弹窗
 * 过去各自 getStatus，同一账号在不同面会出现「一处已登录、一处未登录」的分裂。
 * 这里按 Lyra `useNimbusActiveSession` 的思路收敛成单一数据源：
 *   - 模块级快照：所有订阅方（hook）读同一份数据，mount 先渲染缓存；
 *   - 登录/登出后由操作方调用 `notifyNimbusAccountChanged` 广播（带乐观快照），
 *     再后台重校验收敛；
 *   - 窗口获焦 / 重新可见时静默重校验，兜底事件丢失（登录发生在别处、面板曾未挂载）；
 *   - 请求去重：并发 refresh 共享同一次 in-flight getStatus，不因多面挂载重复打后端。
 *
 * 失败降级：getStatus 出错只写 error 快照，不抛穿给 UI —— 查询失败不得把侧边栏或
 * 设置页打崩；未登录（401/无凭证）由服务层归一成 `{ loggedIn: false }` 正常返回。
 */
import { useEffect, useState } from "react";
import type { QuotaStatusResult } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

/** 共享状态快照（订阅方渲染用）。 */
export interface NimbusAccountState {
  /** 最近一次成功读到的登录态；null = 还没成功问过（区分「未登录」与「未知」）。 */
  readonly status: QuotaStatusResult | null;
  readonly loggedIn: boolean;
  /** 已登录时的展示名（服务端 nickname/username）。 */
  readonly username: string | null;
  /** 有 getStatus 在途（首次加载或获焦重校验）。 */
  readonly loading: boolean;
  /** 最近一次刷新失败的错误文案；不影响已缓存的 status 展示。 */
  readonly error: string | null;
}

/** 状态模块只依赖 getStatus 这一个方法，便于测试注入与跨服务实例复用。 */
export interface NimbusAccountServiceLike {
  getStatus(): Promise<QuotaStatusResult>;
}

let boundService: NimbusAccountServiceLike | null = null;
let state: NimbusAccountState = {
  status: null,
  loggedIn: false,
  username: null,
  loading: false,
  error: null,
};
const listeners = new Set<() => void>();
let refreshPromise: Promise<void> | null = null;

function toState(
  status: QuotaStatusResult | null,
  loading: boolean,
  error: string | null,
): NimbusAccountState {
  const loggedIn = status !== null && status.loggedIn;
  return {
    status,
    loggedIn,
    username: status !== null && status.loggedIn ? status.account.username : null,
    loading,
    error,
  };
}

function update(next: NimbusAccountState): void {
  state = next;
  // 通知集取调用时刻的快照：循环中订阅方增删（React 卸载竞态等）不得改变本次通知集合。
  // eslint-disable-next-line unicorn/no-useless-spread -- 见上：快照是刻意行为，非冗余复制
  for (const listener of [...listeners]) listener();
}

/** 读当前快照（非 React 场景 / hook 的初始值）。 */
export function getNimbusAccountState(): NimbusAccountState {
  return state;
}

/** 订阅快照变化；返回取消订阅函数。 */
export function subscribeNimbusAccountState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 由 hook 在 mount 时把宿主服务绑定进来（后绑定覆盖先绑定）：
 * 工作区作用域切换时 hook 重挂，绑定跟随新实例。
 */
export function bindNimbusAccountService(service: NimbusAccountServiceLike): void {
  boundService = service;
}

/**
 * 重拉登录态。并发调用共享同一次请求；未绑定服务时直接返回（组件还没挂过）。
 * 失败只落 error 快照，绝不抛穿。
 */
export function refreshNimbusAccountState(): Promise<void> {
  if (!boundService) return Promise.resolve();
  if (refreshPromise) return refreshPromise;
  const service = boundService;
  update({ ...state, loading: true, error: null });
  refreshPromise = service
    .getStatus()
    .then((status) => {
      update(toState(status, false, null));
    })
    .catch((error: unknown) => {
      update({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/**
 * 登录/登出后广播：带乐观快照立即切换所有订阅方，再后台重校验收敛。
 * 调用方：WelcomeScreen（登录成功）、NimbusAccountDialog（登录/登出）、
 * 侧边栏底部的 Nimbus 登出。
 */
export function notifyNimbusAccountChanged(status: QuotaStatusResult): void {
  update(toState(status, false, null));
  void refreshNimbusAccountState();
}

/**
 * 订阅型 hook：mount 时绑定服务、先渲染模块缓存，再后台重校验；
 * 窗口获焦 / 重新可见时静默重校验。
 */
export function useNimbusAccountState(): NimbusAccountState {
  const { providerQuotaService } = useServices();
  const [snapshot, setSnapshot] = useState<NimbusAccountState>(getNimbusAccountState);

  useEffect(() => {
    bindNimbusAccountService(providerQuotaService);
    const unsubscribe = subscribeNimbusAccountState(() => setSnapshot(getNimbusAccountState()));
    // 不能只读缓存：缓存可能是登录前的旧快照（WelcomeScreen 登录完成后主界面才挂载），
    // 无条件后台重校验，让「登录成功 → 侧边栏立刻显示账号」无需等下一个事件。
    void refreshNimbusAccountState();
    const revalidate = () => {
      if (document.visibilityState === "hidden") return;
      void refreshNimbusAccountState();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [providerQuotaService]);

  return snapshot;
}
