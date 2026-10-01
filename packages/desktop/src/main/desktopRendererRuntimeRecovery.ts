/**
 * renderer 运行期自愈。
 *
 * 启动期的三种失败已被覆盖（导航重试 / dom-ready 后的启动存活看门狗 / 启动壳失败面板），
 * 但「界面已经正常跑起来、之后才卡死」这条路一直是裸的：主窗口的 render-process-gone
 * 只复位了快捷键录制状态，unresponsive 只打一条日志，用户只能杀掉整个应用重启。
 *
 * 设计约束（必须遵守）：
 * - **零轮询、零定时扫描**。没有「每 N 秒 ping 一次」这类心跳——那本身就是性能税，
 *   而且在 renderer 主线程被阻塞时心跳照样发不出来。这里只挂 Electron 原生事件：
 *   render-process-gone / unresponsive / responsive。
 * - 唯一的 timer 是 unresponsive 之后的**一次性宽限**，而且只在事件到达时才存在；
 *   renderer 自己恢复（responsive）就立刻取消，不留任何常驻定时器。
 * - 恢复预算有界并带冷却：连续恢复会耗尽预算转人工；距离上次恢复足够久则重置预算，
 *   避免「页面本身必然崩溃」时变成无限重载风暴。
 *
 * 注意 renderer 重载是**非破坏性**的：host/CLI 进程与窗口同生命周期，重载只补挂一条新的
 * RPC MessagePort（见 desktopWindowLifecycle 的 reattach 分支），会话不会丢。
 */

/** 连续自动恢复的上限；超出后停止自动重载，把入口交给用户。 */
export const MAX_RUNTIME_RENDERER_RECOVERIES = 2;

/** 距离上次自动恢复超过这个时长，就认为期间界面是健康的，预算重置。 */
export const RUNTIME_RECOVERY_BUDGET_RESET_MS = 10 * 60_000;

/**
 * unresponsive 之后等待多久才真正重载。Electron 判定 unresponsive 本身已经等了一轮
 * （默认约 5s），这里再给一个宽限，让「大对话渲染导致的瞬时卡顿」有机会自己缓过来。
 */
export const UNRESPONSIVE_RECOVERY_GRACE_MS = 10_000;

import type { BrowserWindow } from "electron";

export type RendererRuntimeRecoveryReason = "render-process-gone" | "unresponsive";

export interface RendererRuntimeRecoveryOptions {
  /** 执行一次恢复；通常就是 webContents.reload()。 */
  reload: () => void;
  /** 窗口或 webContents 已销毁时返回 true，立即停止一切恢复。 */
  isDestroyed: () => boolean;
  /** 发生了自动恢复（用于日志与用户提示）。 */
  onRecover: (info: { reason: RendererRuntimeRecoveryReason; recoveries: number }) => void;
  /** 预算耗尽，不再自动恢复，需要用户手动介入。 */
  onExhausted?: (info: { reason: RendererRuntimeRecoveryReason }) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}

export interface RendererRuntimeRecovery {
  /** webContents 的 render-process-gone。 */
  noteRenderProcessGone: (details: { reason?: string }) => void;
  /** webContents 的 unresponsive：只安排一次性宽限，不做任何周期检查。 */
  noteUnresponsive: () => void;
  /** webContents 的 responsive：界面自己活过来了，撤销待执行的恢复。 */
  noteResponsive: () => void;
  /** 窗口销毁时清理待执行的恢复。 */
  dispose: () => void;
}

/** `clean-exit` 是正常退出（关窗/退出应用），不是崩溃，不能触发恢复。 */
function isCrashReason(reason: string | undefined): boolean {
  return reason !== undefined && reason !== "clean-exit";
}

export function createRendererRuntimeRecovery(
  options: RendererRuntimeRecoveryOptions,
): RendererRuntimeRecovery {
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancelScheduled =
    options.cancelScheduled ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let recoveries = 0;
  let lastRecoveryAt: number | undefined;
  let pending: unknown | undefined;

  const cancelPending = () => {
    if (pending === undefined) {
      return;
    }
    cancelScheduled(pending);
    pending = undefined;
  };

  const resetBudgetIfCooled = () => {
    if (lastRecoveryAt === undefined) {
      return;
    }
    if (now() - lastRecoveryAt >= RUNTIME_RECOVERY_BUDGET_RESET_MS) {
      recoveries = 0;
    }
  };

  const attemptRecover = (reason: RendererRuntimeRecoveryReason) => {
    if (options.isDestroyed()) {
      return;
    }
    resetBudgetIfCooled();
    if (recoveries >= MAX_RUNTIME_RENDERER_RECOVERIES) {
      options.onExhausted?.({ reason });
      return;
    }
    recoveries += 1;
    lastRecoveryAt = now();
    options.onRecover({ reason, recoveries });
    options.reload();
  };

  return {
    noteRenderProcessGone(details) {
      if (!isCrashReason(details.reason)) {
        return;
      }
      // renderer 进程已经没了，任何待执行的宽限都失去意义，直接恢复。
      cancelPending();
      attemptRecover("render-process-gone");
    },
    noteUnresponsive() {
      if (options.isDestroyed() || pending !== undefined) {
        return;
      }
      pending = schedule(() => {
        pending = undefined;
        attemptRecover("unresponsive");
      }, UNRESPONSIVE_RECOVERY_GRACE_MS);
    },
    noteResponsive() {
      cancelPending();
    },
    dispose() {
      cancelPending();
    },
  };
}

/**
 * 把运行期自愈挂到一个主窗口上。
 *
 * 必须在 `dom-ready` 之外调用：`dom-ready` 每次重载都会重新触发，挂进去会让监听器
 * 随重载不断叠加。返回的句柄在窗口 `closed` 时 `dispose()`。
 */
export function attachRendererRuntimeRecovery(
  win: BrowserWindow,
  options: { logger: { warn: (...args: unknown[]) => void }; label: string },
): RendererRuntimeRecovery {
  const { label } = options;
  const recovery = createRendererRuntimeRecovery({
    reload: () => {
      if (win.isDestroyed()) {
        return;
      }
      win.webContents.reload();
    },
    isDestroyed: () => win.isDestroyed() || win.webContents.isDestroyed(),
    onRecover: ({ reason, recoveries }) => {
      options.logger.warn(
        `[createWindow] renderer runtime recovery (${label}), reason=${reason}, attempt=${recoveries}`,
      );
    },
    onExhausted: ({ reason }) => {
      options.logger.warn(
        `[createWindow] renderer runtime recovery budget exhausted (${label}), reason=${reason}; manual reload required`,
      );
    },
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    recovery.noteRenderProcessGone(details);
  });
  win.webContents.on("unresponsive", () => {
    recovery.noteUnresponsive();
  });
  win.webContents.on("responsive", () => {
    recovery.noteResponsive();
  });
  return recovery;
}
