/**
 * 遥测出口（本地实现，已替换阿里云 ARMS RUM SDK）。
 *
 * **为什么不再用 SDK**：ARMS 是 ZCode 绑定的厂商通道，不是通用能力。Polaris 不会向它上报，
 * 却要为它把 4.8MB 的 SDK 打进主进程产物。这里保留**同一个调用面**
 * （`init` / `sendCustom` / `sendEvent` / `setConfig` / `getConfig` / `client.useReporter`），
 * 于是九个采集模块一行都不用改。
 *
 * **分工**：采集、开关、过滤、归因、脱敏留在各自模块与 `init` 的 `onBatch` 钩子里；
 * 本文件只做「攒批 → 交给 onBatch → 出网」。出网传输当前**未接**（`transport` 为 null），
 * 所以事件处理完即丢——与遥测默认关闭时的行为一致。接自有后端时只改本文件：
 * 在 `init` 里挂 `transport`（或直接实现 flush 的目标地址）即可，采集侧不动。
 */

/** 事件载荷：调用方传的是各自组装的强类型对象，这里只当成可展开的属性包。 */
export type TelemetryEventPayload = object;

export interface TelemetryBatch {
  events: Array<Record<string, unknown>>;
}

/** 出网前的最后一道加工；返回改写后的批次（就地改写也可）。 */
export type TelemetryBatchHook = (batch: TelemetryBatch) => TelemetryBatch | void;

export interface TelemetrySinkInitOptions {
  readonly enable: boolean;
  readonly endpoint: string;
  readonly version: string;
  readonly env: string;
  readonly app?: Record<string, unknown>;
  readonly user?: Record<string, unknown>;
  /**
   * 出网前的最后一道加工：原生 crash 过滤、API 批次 ingest、长任务归因摘要、隐私脱敏。
   * 这些必须留在调用方，因为它们依赖主进程的采集上下文。
   */
  readonly onBatch?: TelemetryBatchHook;
}

/**
 * 投递口：批次加工完之后交给它出网。
 *
 * 采集侧通过 `client.useReporter` 安装（启动期会在外面再包一层投递确认日志）。
 * 没人安装时批次在加工后就地丢弃——这就是「传输未接」的状态，与遥测默认关闭一致。
 */
export interface TelemetryReporter {
  request: (context: unknown, bundle: TelemetryBatch) => unknown;
}

export interface TelemetryClient {
  useReporter: (reporter: TelemetryReporter) => void;
}

export interface TelemetryConfig {
  env?: string;
}

/** 攒批上限：不能因为没接传输就让待发事件无限增长。 */
const MAX_PENDING_EVENTS = 500;

let options: TelemetrySinkInitOptions | null = null;
let globalProperties: Record<string, unknown> = {};
let globalUser: Record<string, unknown> = {};
let reporter: TelemetryReporter | null = null;
const pending: Array<Record<string, unknown>> = [];

function isEnabled(): boolean {
  return options?.enable === true;
}

function flush(): void {
  if (!options || !isEnabled() || pending.length === 0) return;
  const batch: TelemetryBatch = { events: pending.splice(0, pending.length) };
  const processed = options.onBatch?.(batch) ?? batch;
  // 未安装 reporter 即没有出网通道：加工完（过滤/归因/脱敏都已生效）就地丢弃。
  reporter?.request(undefined, processed);
}

export const telemetrySink = {
  client: {
    useReporter(next: TelemetryReporter): void {
      reporter = next;
    },
  } satisfies TelemetryClient,

  async init(next: TelemetrySinkInitOptions): Promise<void> {
    options = next;
    globalProperties = {};
    globalUser = { ...(next.user ?? {}) };
    pending.length = 0;
  },

  getConfig(): TelemetryConfig {
    return options === null ? {} : { env: options.env };
  },

  setConfig(section: "properties" | "user", value: Record<string, unknown>): void {
    // 采集停用时未 init，写入必须静默丢弃：调用方（登出/切号、资源采样）不该因此失败。
    if (!isEnabled()) return;
    if (section === "properties") {
      globalProperties = { ...globalProperties, ...value };
      return;
    }
    globalUser = { ...globalUser, ...value };
  },

  sendCustom(event: TelemetryEventPayload): void {
    push({ ...globalProperties, ...globalUser, ...(event as Record<string, unknown>) });
  },

  sendEvent(event: TelemetryEventPayload): void {
    push({ ...globalProperties, ...globalUser, ...(event as Record<string, unknown>) });
  },
};

function push(event: Record<string, unknown>): void {
  if (!isEnabled()) return;
  if (pending.length >= MAX_PENDING_EVENTS) pending.shift();
  pending.push(event);
  flush();
}

/** 采集侧沿用的默认导出形状（替代 `import armsRum from "@arms/rum-electron"`）。 */
export default telemetrySink;
