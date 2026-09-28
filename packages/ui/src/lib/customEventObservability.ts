import type { CustomTelemetryEventPayload } from "@zcode/shared";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";

interface CustomTelemetryEventE2EEntry extends CustomTelemetryEventPayload {
  recordedAt: number;
}

const MAX_CUSTOM_TELEMETRY_EVENT_ENTRIES = 200;

type CustomTelemetryEventDebugWindow = Window & {
  __zcodeCustomTelemetryEventsE2E?: CustomTelemetryEventE2EEntry[];
};

/**
 * 仅 E2E 构建记录 renderer 实际提交给 desktop bridge 的遥测 payload。
 * 缓冲保持有界，且生产构建不创建 window 字段，避免形成第二套持久化或回放通道。
 */
export function recordCustomTelemetryEventForE2E(
  payload: CustomTelemetryEventPayload,
  options: {
    enabled?: boolean;
    host?: CustomTelemetryEventDebugWindow;
    now?: () => number;
  } = {},
): void {
  const enabled = options.enabled ?? shouldExposeE2EStoreBridge();
  if (!enabled || (typeof window === "undefined" && !options.host)) return;

  const host = options.host ?? (window as CustomTelemetryEventDebugWindow);
  const buffer = (host.__zcodeCustomTelemetryEventsE2E ??= []);
  buffer.push({
    ...payload,
    ...(payload.properties ? { properties: { ...payload.properties } } : {}),
    recordedAt: (options.now ?? Date.now)(),
  });
  if (buffer.length > MAX_CUSTOM_TELEMETRY_EVENT_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_CUSTOM_TELEMETRY_EVENT_ENTRIES);
  }
}
