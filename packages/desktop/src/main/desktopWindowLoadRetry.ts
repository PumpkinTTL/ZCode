/**
 * 主窗口导航失败的重试策略。
 *
 * 现场事实：dev server 正在重启、依赖预构建换代（模块图 504）、瞬时连接错误时，
 * 主窗口的首次导航会失败。旧实现只把失败的导航 Promise 打成一条 warn，窗口就停在
 * chrome-error 或空白页上，用户只能重启整个应用。这里按短退避重新导航把窗口救回来。
 *
 * 抽成纯函数便于用真实执行验证（不依赖 Electron 运行时）。
 */

export interface MainWindowLoadRetryInfo {
  /** 从 1 开始的第几次重试。 */
  attempt: number;
  /** 这次重试前的等待时长。 */
  delayMs: number;
  error: unknown;
}

export interface MainWindowLoadRetryOptions {
  /** 执行一次导航；失败时 reject。 */
  load: () => Promise<void>;
  /** 窗口已销毁或导航已被主动取消时返回 true，立即停止重试。 */
  shouldStop?: () => boolean;
  /** 每次重试前的等待时长；长度即最大重试次数。 */
  delaysMs?: readonly number[];
  /** 判定“导航被主动取消”（同窗口二次导航、重定向接管），这类失败重试没有意义。 */
  isAborted?: (error: unknown) => boolean;
  onRetry?: (info: MainWindowLoadRetryInfo) => void;
  onFailure?: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface MainWindowLoadRetryResult {
  /** 实际执行的导航次数（首次 + 重试）。 */
  attempts: number;
  ok: boolean;
  error?: unknown;
}

export const DEFAULT_MAIN_WINDOW_LOAD_RETRY_DELAYS_MS = [400, 1_200, 3_000, 6_000] as const;

/** Electron 在导航被主动取消时给出的错误码。 */
export function isMainWindowLoadAborted(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === "ERR_ABORTED";
}

export async function loadMainWindowWithRetry(
  options: MainWindowLoadRetryOptions,
): Promise<MainWindowLoadRetryResult> {
  const delaysMs = options.delaysMs ?? DEFAULT_MAIN_WINDOW_LOAD_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const shouldStop = options.shouldStop ?? (() => false);
  const isAborted = options.isAborted ?? isMainWindowLoadAborted;
  let attempts = 0;
  let retries = 0;

  for (;;) {
    attempts += 1;
    try {
      await options.load();
      return { attempts, ok: true };
    } catch (error) {
      if (shouldStop() || isAborted(error) || retries >= delaysMs.length) {
        options.onFailure?.(error);
        return { attempts, ok: false, error };
      }
      const delayMs = delaysMs[retries] ?? delaysMs[delaysMs.length - 1] ?? 0;
      retries += 1;
      options.onRetry?.({ attempt: retries, delayMs, error });
      await sleep(delayMs);
      if (shouldStop()) {
        options.onFailure?.(error);
        return { attempts, ok: false, error };
      }
    }
  }
}
