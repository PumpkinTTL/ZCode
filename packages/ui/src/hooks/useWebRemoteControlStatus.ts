import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { IPlatformService, WebRemoteControlStatus } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

const IDLE_WEB_REMOTE_CONTROL_STATUS: WebRemoteControlStatus = { status: "idle" };

function isSameWebRemoteControlStatus(
  left: WebRemoteControlStatus,
  right: WebRemoteControlStatus,
): boolean {
  return (
    left.status === right.status &&
    left.sessionId === right.sessionId &&
    left.windowControlSessionId === right.windowControlSessionId &&
    left.mobileConnected === right.mobileConnected &&
    left.mobileViewState?.activeWorkspaceKey === right.mobileViewState?.activeWorkspaceKey &&
    left.mobileViewState?.activeTaskId === right.mobileViewState?.activeTaskId &&
    left.mobileViewState?.updatedAt === right.mobileViewState?.updatedAt &&
    left.mobileDeviceInfo?.updatedAt === right.mobileDeviceInfo?.updatedAt &&
    left.mobileDeviceInfo?.userAgent === right.mobileDeviceInfo?.userAgent &&
    left.mobileDeviceInfo?.viewport?.width === right.mobileDeviceInfo?.viewport?.width &&
    left.mobileDeviceInfo?.viewport?.height === right.mobileDeviceInfo?.viewport?.height &&
    left.error === right.error &&
    left.failure?.reason === right.failure?.reason &&
    left.failure?.message === right.failure?.message
  );
}

type SharedWebRemoteControlStatusPlatform = Pick<
  IPlatformService,
  "getWebRemoteControlStatus" | "onWebRemoteControlStatusChanged"
>;

interface SharedWebRemoteControlStatusStore {
  getStatus(): WebRemoteControlStatus;
  /** 返回退订函数；首个订阅者负责接事件推送并立刻同步一次，最后一个退订者停表复位。 */
  subscribe(intervalMs: number, listener: () => void): () => void;
}

/**
 * 每窗口一份的远控状态共享订阅（按 platform 实例隔离）。
 *
 * 为什么改：`Root.tsx` / `WorkspaceSidebar.tsx` / `WorkspaceWebRemoteControlTrigger.tsx` 三处
 * 同时挂载本 hook，过去每处各持一个 1s 定时器与各自 state——同一秒内同一份状态要跑 3 次
 * `getWebRemoteControlStatus` IPC、做 3 组状态对象逐字段比较，且三份 state 之间没有一致性保证。
 *
 * 语义保持：仍是 1s 轮询（间隔取当时订阅者里的最小值）、挂载即立刻同步一次、main 推送的事件
 * 优先消费、状态无变化时通知为 no-op（不触发重渲染）。唯一差别是最后一个 enabled 订阅者离开时
 * 停表并把状态复位为 idle，使下一次挂载的表现与「新挂载的 hook」完全一致，不会先渲染上一轮遗留值。
 */
const sharedWebRemoteControlStatusStores = new WeakMap<object, SharedWebRemoteControlStatusStore>();

function createSharedWebRemoteControlStatusStore(
  platform: SharedWebRemoteControlStatusPlatform,
): SharedWebRemoteControlStatusStore {
  const listeners = new Set<() => void>();
  // subscriberId → 该订阅者请求的间隔；多个订阅者并存时按最小间隔轮询。
  const subscriberIntervals = new Map<number, number>();
  let nextSubscriberId = 1;
  let status: WebRemoteControlStatus = IDLE_WEB_REMOTE_CONTROL_STATUS;
  let intervalId: number | null = null;
  let activeIntervalMs: number | null = null;
  let disposePlatformStatusChanged: (() => void) | null = null;
  let syncInFlight = false;

  const notify = () => {
    // 直接迭代：Set 在迭代中删除当前项是安全的，退订会被立刻生效。
    for (const listener of listeners) {
      listener();
    }
  };

  const applyStatus = (nextStatus: WebRemoteControlStatus) => {
    if (isSameWebRemoteControlStatus(status, nextStatus)) {
      return;
    }
    status = nextStatus;
    notify();
  };

  const syncStatus = async () => {
    // 上一次请求还在飞时跳过本轮：IPC 卡顿时不再叠加并发请求，落地结果仍是「最新一次」。
    if (syncInFlight) {
      return;
    }
    syncInFlight = true;
    try {
      applyStatus(await platform.getWebRemoteControlStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Bugfix: 远控连接状态来自 main/relay，桌面 UI 必须轮询才能感知手机打开的 task。
      // 轮询失败属于高频诊断信息，只走 debug，避免生产日志随刷新频率增长。
      logger.debug("[useWebRemoteControlStatus] 同步 Web 远程控制状态失败", {
        error: message,
      });
    } finally {
      syncInFlight = false;
    }
  };

  const stopPolling = () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    activeIntervalMs = null;
  };

  const syncPollingInterval = () => {
    if (subscriberIntervals.size === 0) {
      stopPolling();
      return;
    }
    const nextIntervalMs = Math.min(...subscriberIntervals.values());
    if (intervalId !== null && activeIntervalMs === nextIntervalMs) {
      return;
    }
    stopPolling();
    activeIntervalMs = nextIntervalMs;
    intervalId = window.setInterval(() => void syncStatus(), nextIntervalMs);
  };

  const ensurePlatformStatusChanged = () => {
    disposePlatformStatusChanged ??=
      platform.onWebRemoteControlStatusChanged?.((nextStatus) => {
        // Bugfix: start/refresh 后如果只等 1s 轮询，手机立刻扫码时 main 还没拿到 renderer 同步的 task 快照。
        // main 已经是远控 session/transport 状态事实源，这里优先消费事件推送，轮询只保留为旧平台兜底。
        applyStatus(nextStatus);
      }) ?? null;
  };

  return {
    getStatus: () => status,
    subscribe(intervalMs, listener) {
      const subscriberId = nextSubscriberId++;
      const isFirstSubscriber = subscriberIntervals.size === 0;
      subscriberIntervals.set(subscriberId, intervalMs);
      listeners.add(listener);
      if (isFirstSubscriber) {
        // 与原实现挂载时一致：先接事件推送，再立刻同步一次。
        ensurePlatformStatusChanged();
        void syncStatus();
      }
      syncPollingInterval();
      return () => {
        subscriberIntervals.delete(subscriberId);
        listeners.delete(listener);
        syncPollingInterval();
        if (subscriberIntervals.size === 0) {
          disposePlatformStatusChanged?.();
          disposePlatformStatusChanged = null;
          status = IDLE_WEB_REMOTE_CONTROL_STATUS;
        }
      };
    },
  };
}

function getSharedWebRemoteControlStatusStore(
  platform: SharedWebRemoteControlStatusPlatform,
): SharedWebRemoteControlStatusStore {
  const existing = sharedWebRemoteControlStatusStores.get(platform);
  if (existing) {
    return existing;
  }
  const created = createSharedWebRemoteControlStatusStore(platform);
  sharedWebRemoteControlStatusStores.set(platform, created);
  return created;
}

export function useWebRemoteControlStatus({
  enabled = true,
  intervalMs = 1000,
}: {
  enabled?: boolean;
  intervalMs?: number;
} = {}): WebRemoteControlStatus {
  const platform = useOptionalPlatform();
  const store = useMemo(
    () => (platform ? getSharedWebRemoteControlStatusStore(platform) : null),
    [platform],
  );
  const active = Boolean(enabled && store);
  const subscribe = useCallback(
    (listener: () => void) => (active && store ? store.subscribe(intervalMs, listener) : () => {}),
    [active, store, intervalMs],
  );
  const getSnapshot = useCallback(
    () => (active && store ? store.getStatus() : IDLE_WEB_REMOTE_CONTROL_STATUS),
    [active, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
