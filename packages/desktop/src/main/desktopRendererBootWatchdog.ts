import type { BrowserWindow } from "electron";

/**
 * renderer 启动存活看门狗。
 *
 * 现场事实（~/.polaris/v2/logs）：`dom-ready` 与「reattached to existing host」都正常打出，
 * 但此后 renderer 再没有写进任何一行日志 —— 界面脚本没有跑起来（dev server 重启、模块图 504、
 * 主入口执行期抛错）。窗口停在空 #root 上，用户只能杀掉整个应用重启。
 *
 * 这里给主进程一条独立于 renderer 的兜底：dom-ready 之后若迟迟收不到任何 renderer 存活信号
 * （启动壳的 snapshot 控制消息或业务 Root 的 RendererReady），就主动 reload 一次。
 * 只自动恢复一次，避免与「数据库迁移本来就慢」这类正常长启动互相追赶。
 */

/** dom-ready 后等待 renderer 主动说话的时长；超过即视为这次加载失败。 */
const RENDERER_BOOT_ALIVE_TIMEOUT_MS = 30_000;

/** 每个窗口最多自动 reload 一次；之后只记录日志，把重试入口交给用户。 */
const MAX_AUTOMATIC_RENDERER_RECOVERIES = 1;

/**
 * renderer 的存活消息可能早于 main 的 dom-ready 处理器：模块脚本先于 DOMContentLoaded 执行，
 * 启动壳的 snapshot 控制消息因此可能先到达。这段时间内的存活消息要算作当前这次加载的证据。
 */
const RENDERER_ALIVE_RACE_GRACE_MS = 2_000;

interface RendererBootWatchdogState {
  timer: ReturnType<typeof setTimeout> | undefined;
  automaticRecoveries: number;
  lastAliveAt: number | undefined;
}

const states = new WeakMap<BrowserWindow, RendererBootWatchdogState>();

function stateFor(win: BrowserWindow): RendererBootWatchdogState {
  const existing = states.get(win);
  if (existing) {
    return existing;
  }
  const created: RendererBootWatchdogState = {
    timer: undefined,
    automaticRecoveries: 0,
    lastAliveAt: undefined,
  };
  states.set(win, created);
  return created;
}

function clearTimer(state: RendererBootWatchdogState): void {
  if (state.timer === undefined) {
    return;
  }
  clearTimeout(state.timer);
  state.timer = undefined;
}

/**
 * 在 dom-ready 后调用。`onTimeout` 只在「这段加载里 renderer 一句话都没说」时触发一次，
 * 且每个窗口的全生命周期最多触发 `MAX_AUTOMATIC_RENDERER_RECOVERIES` 次。
 */
export function armRendererBootWatchdog(
  win: BrowserWindow,
  onTimeout: () => void,
  timeoutMs = RENDERER_BOOT_ALIVE_TIMEOUT_MS,
): void {
  const state = stateFor(win);
  clearTimer(state);
  if (
    state.lastAliveAt !== undefined &&
    Date.now() - state.lastAliveAt < RENDERER_ALIVE_RACE_GRACE_MS
  ) {
    // renderer 已经先说话了（snapshot 与 dom-ready 竞态），这次加载无需看门狗。
    return;
  }
  if (state.automaticRecoveries >= MAX_AUTOMATIC_RENDERER_RECOVERIES) {
    return;
  }
  state.timer = setTimeout(() => {
    state.timer = undefined;
    state.automaticRecoveries += 1;
    onTimeout();
  }, timeoutMs);
}

/**
 * renderer 的任何存活信号（启动壳控制消息 / 业务 Root 就绪）都会解除这次看门狗。
 *
 * 必须用 `stateFor` 建档而不能在“还没 arm 过”时提前返回：模块脚本先于 DOMContentLoaded 执行，
 * 启动壳的 snapshot 控制消息可能早于 main 的 dom-ready 处理器到达，这条竞态消息就是这次加载
 * 唯一的存活证据；丢掉它会让看门狗在缓启动界面上误触自动重载。
 */
export function noteRendererBootAlive(win: BrowserWindow): void {
  const state = stateFor(win);
  state.lastAliveAt = Date.now();
  clearTimer(state);
}

/** 窗口销毁时清理；recovery 计数随窗口一起丢弃。 */
export function disposeRendererBootWatchdog(win: BrowserWindow): void {
  const state = states.get(win);
  if (!state) {
    return;
  }
  clearTimer(state);
  states.delete(win);
}
