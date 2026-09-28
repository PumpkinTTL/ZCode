import type {
  CustomTelemetryEventPayload,
  TelemetryEnvLabel,
  ConfigureFinalCustomTelemetryEventE2ERequest,
  FinalCustomTelemetryEventE2EEntry,
  FinalCustomTelemetryEventPayload,
} from "@zcode/shared";

const MAX_FINAL_CUSTOM_TELEMETRY_EVENT_E2E_ENTRIES = 200;
const MAX_SUPPRESSED_EVENT_NAMES = 100;
const MAX_EVENT_NAME_LENGTH = 256;

export interface FinalCustomTelemetryEventE2EController {
  record(payload: FinalCustomTelemetryEventPayload): void;
  read(): FinalCustomTelemetryEventE2EEntry[];
  clear(): void;
  configure(request: ConfigureFinalCustomTelemetryEventE2ERequest): void;
  shouldSuppress(eventName: string): boolean;
}

function normalizeOsCategory(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

function cloneFinalPayload(payload: FinalCustomTelemetryEventPayload): FinalCustomTelemetryEventPayload {
  return {
    ...payload,
    properties: { ...payload.properties },
  };
}

function normalizeSuppressedEventNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_SUPPRESSED_EVENT_NAMES) {
    throw new Error("suppressedEventNames 必须是最多 100 项的字符串数组");
  }
  const names = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("suppressedEventNames 只能包含字符串");
    }
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_EVENT_NAME_LENGTH) {
      throw new Error("suppressedEventNames 包含空值或超长 event name");
    }
    return normalized;
  });
  return [...new Set(names)];
}

/** Main-process 内存 ring；不写磁盘，也不进入 renderer store。 */
function createFinalCustomTelemetryEventE2EController(
  options: {
    capacity?: number;
    now?: () => number;
  } = {},
): FinalCustomTelemetryEventE2EController {
  const requestedCapacity = options.capacity ?? MAX_FINAL_CUSTOM_TELEMETRY_EVENT_E2E_ENTRIES;
  const capacity = Math.max(
    1,
    Math.min(
      Number.isFinite(requestedCapacity)
        ? Math.trunc(requestedCapacity)
        : MAX_FINAL_CUSTOM_TELEMETRY_EVENT_E2E_ENTRIES,
      MAX_FINAL_CUSTOM_TELEMETRY_EVENT_E2E_ENTRIES,
    ),
  );
  const now = options.now ?? Date.now;
  const entries: FinalCustomTelemetryEventE2EEntry[] = [];
  let nextSequence = 1;
  let suppressedEventNames = new Set<string>();

  return {
    record(payload) {
      entries.push({
        sequence: nextSequence,
        recordedAt: now(),
        payload: cloneFinalPayload(payload),
      });
      nextSequence += 1;
      if (entries.length > capacity) {
        entries.splice(0, entries.length - capacity);
      }
    },
    read() {
      return entries.map((entry) => ({
        ...entry,
        payload: cloneFinalPayload(entry.payload),
      }));
    },
    clear() {
      entries.splice(0, entries.length);
    },
    configure(request) {
      suppressedEventNames = new Set(normalizeSuppressedEventNames(request?.suppressedEventNames));
    },
    shouldSuppress(eventName) {
      return suppressedEventNames.has(eventName);
    },
  };
}

/**
 * main 侧共享的 E2E 捕获环。
 *
 * renderer 经 IPC 来的自定义事件与 main 自己发出的资源 / 稳定性事件必须进同一个环，
 * 否则 E2E 只能看到 renderer 那一半。由 `desktopMainIpcRemote` 在双门禁下开启。
 */
let sharedFinalCustomTelemetryEventE2E: FinalCustomTelemetryEventE2EController | null = null;

export function enableSharedFinalCustomTelemetryEventE2EController(
  options?: Parameters<typeof createFinalCustomTelemetryEventE2EController>[0],
): FinalCustomTelemetryEventE2EController {
  sharedFinalCustomTelemetryEventE2E = createFinalCustomTelemetryEventE2EController(options);
  return sharedFinalCustomTelemetryEventE2E;
}

export function getSharedFinalCustomTelemetryEventE2EController(): FinalCustomTelemetryEventE2EController | null {
  return sharedFinalCustomTelemetryEventE2E;
}

export function buildFinalCustomTelemetryEventPayload(params: {
  payload: CustomTelemetryEventPayload;
  context: {
    deviceMid: string;
    platform: NodeJS.Platform;
    appVersion: string;
    telemetryEnv: TelemetryEnvLabel;
    rendererId: number;
  };
}): FinalCustomTelemetryEventPayload {
  const metricValue = params.payload.value ?? 1;
  const rawProperties: Record<string, string | number | boolean | undefined> = {
    event_name: params.payload.name,
    app_version: params.context.appVersion,
    telemetry_env: params.context.telemetryEnv,
    device_mid: params.context.deviceMid,
    platform: normalizeOsCategory(params.context.platform),
    renderer_id: params.context.rendererId,
    metric_value: metricValue,
    ...params.payload.properties,
  };
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (value !== undefined) {
      properties[key] = String(value);
    }
  }

  return {
    name: params.payload.name,
    type: "custom",
    group: params.payload.group,
    value: metricValue,
    properties,
  };
}

/** 捕获发生在 sendCustom 调用前，网络抑制只跳过目标 event name。 */
export function dispatchFinalCustomTelemetryEvent(params: {
  payload: CustomTelemetryEventPayload;
  context: Parameters<typeof buildFinalCustomTelemetryEventPayload>[0]["context"];
  e2eController?: FinalCustomTelemetryEventE2EController | null;
  sendCustom: (payload: FinalCustomTelemetryEventPayload) => void;
}): { payload: FinalCustomTelemetryEventPayload; suppressed: boolean } {
  const payload = buildFinalCustomTelemetryEventPayload(params);
  params.e2eController?.record(payload);
  const suppressed = params.e2eController?.shouldSuppress(payload.name) ?? false;
  if (!suppressed) {
    params.sendCustom(payload);
  }
  return { payload, suppressed };
}
