/**
 * 系统公告 / 全站灰纪念模式的渲染层共享状态（免登录端点，登录页与已登录主界面共用）。
 *
 * 与 nimbusAccountState 同一思路的模块级快照 + 订阅：
 *   - 登录页公告条、设置页「我的额度」公告条与 Root 的全站灰阶挂点都读同一份数据，
 *     并发刷新共享同一次 in-flight 请求（后端 /user/notice 有 60s 缓存，请求很轻，
 *     去重只为避免同帧多组件重复发请求）；
 *   - 全站灰纪念模式的 active 由后端按当前时间算好，这里只负责透传：
 *     Root 挂点据此开/关 documentElement 的灰阶 filter，公告条据此渲染；
 *   - 刷新时机：mount + 窗口获焦 / 重新可见 + 低频定时轮询（纪念模式有起止时刻，
 *     窗口跨界时即使无焦点事件也能在一轮轮询内收敛）。
 *
 * 失败降级：公告是纯展示数据，查询失败只落 error 快照不抛穿，公告条不渲染、
 * 灰阶维持上一状态（首查失败即不灰），不打崩任何挂载面。
 */
import { useEffect, useState } from "react";
import type { QuotaNotice } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

/** 共享状态快照（订阅方渲染用）。notice=null = 还没成功问过后端。 */
export interface SystemNoticeState {
  readonly notice: QuotaNotice | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** 本模块只依赖 getNotice 这一个方法，便于测试注入。 */
export interface SystemNoticeServiceLike {
  getNotice(signal?: AbortSignal): Promise<QuotaNotice>;
}

/** 纪念模式轮询间隔：覆盖窗口起止跨界，同时远低于后端 60s 缓存压力。 */
const NOTICE_REPOLL_INTERVAL_MS = 5 * 60 * 1000;

let boundService: SystemNoticeServiceLike | null = null;
let state: SystemNoticeState = { notice: null, loading: false, error: null };
const listeners = new Set<() => void>();
let refreshPromise: Promise<void> | null = null;

function update(next: SystemNoticeState): void {
  state = next;
  // 通知集取调用时刻的快照：循环中订阅方增删（React 卸载竞态等）不得改变本次通知集合。
  // eslint-disable-next-line unicorn/no-useless-spread -- 见上：快照是刻意行为，非冗余复制
  for (const listener of [...listeners]) listener();
}

/** 读当前快照（非 React 场景 / hook 的初始值）。 */
export function getSystemNoticeState(): SystemNoticeState {
  return state;
}

/** 订阅快照变化；返回取消订阅函数。 */
export function subscribeSystemNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 由 hook 在 mount 时把宿主服务绑定进来（后绑定覆盖先绑定）。 */
export function bindSystemNoticeService(service: SystemNoticeServiceLike): void {
  boundService = service;
}

/**
 * 重拉公告。并发调用共享同一次请求；未绑定服务时直接返回（组件还没挂过）。
 * 失败只落 error 快照，绝不抛穿。
 */
export function refreshSystemNotice(): Promise<void> {
  if (!boundService) return Promise.resolve();
  if (refreshPromise) return refreshPromise;
  update({ ...state, loading: true, error: null });
  refreshPromise = boundService
    .getNotice()
    .then((notice) => {
      update({ notice, loading: false, error: null });
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
 * 订阅型 hook：mount 时绑定服务、先渲染模块缓存，再后台重校验；
 * 窗口获焦 / 重新可见与低频定时器触发静默重校验。
 */
export function useSystemNotice(): SystemNoticeState {
  const { providerQuotaService } = useServices();
  const [snapshot, setSnapshot] = useState<SystemNoticeState>(getSystemNoticeState);

  useEffect(() => {
    bindSystemNoticeService(providerQuotaService);
    const unsubscribe = subscribeSystemNotice(() => setSnapshot(getSystemNoticeState()));
    // 无条件后台重校验：缓存可能是上一个公告/灰阶窗口的旧快照。
    void refreshSystemNotice();
    const revalidate = () => {
      if (document.visibilityState === "hidden") return;
      void refreshSystemNotice();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const repollTimer = window.setInterval(revalidate, NOTICE_REPOLL_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.clearInterval(repollTimer);
    };
  }, [providerQuotaService]);

  return snapshot;
}

/**
 * 全站灰纪念模式挂点（Root 专用）：后端标志 active=true 时给 documentElement 挂
 * CSS grayscale filter，其余时刻移除。挂在根元素上可覆盖 React 树 + 所有
 * body 级 portal（弹窗/toast），且按规范根元素上的 filter 不会成为 fixed 后代的
 * 包含块，浮层定位不受影响。active 完全来自 /user/notice 的后端计算结果，
 * 随公告接口刷新（mount / 获焦 / 轮询）自动开或关。
 */
export function useSystemGrayscaleEffect(): void {
  const { notice } = useSystemNotice();
  useEffect(() => {
    document.documentElement.style.filter =
      notice?.grayscale.active === true ? "grayscale(1)" : "";
    return () => {
      document.documentElement.style.filter = "";
    };
  }, [notice]);
}


