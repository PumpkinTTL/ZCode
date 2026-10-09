import { useSyncExternalStore } from "react";

/**
 * 共享秒级时钟，专供运行中“工作中 N 秒”这类时长标签使用。
 *
 * 时间线 renderUnits 不能依赖每秒 tick（那会让整棵会话树每秒全量重建，
 * 是长会话卡死的主链路之一）；把时钟下沉到真正显示时长的叶子组件，
 * 且只在存在订阅者时才走计时器——没有运行中的轮次就零开销。
 */
let currentNowMs = Date.now();
let timer: number | undefined;
const subscribers = new Set<() => void>();

function tick(): void {
  currentNowMs = Date.now();
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (timer === undefined) {
    currentNowMs = Date.now();
    timer = window.setInterval(tick, 1000);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useRunningWorkClock(): number {
  return useSyncExternalStore(subscribe, () => currentNowMs);
}
