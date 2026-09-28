import type {
  CustomTelemetryEventPayload,
  TelemetryEnvLabel,
  FinalCustomTelemetryEventPayload,
  RemoteUsageErrorCategory,
  RemoteUsageRemoteKind,
  RemoteUsageResult,
  RemoteWorkspaceConnectTrigger,
} from "@zcode/shared";
import {
  dispatchFinalCustomTelemetryEvent,
  type FinalCustomTelemetryEventE2EController,
} from "./desktopCustomTelemetryEvent.js";

const REMOTE_USAGE_TELEMETRY_GROUP = "remote_usage";
const REMOTE_USAGE_EVENT_CONNECT_RESULT = "remote_connect_result";
const REMOTE_USAGE_EVENT_ACTIVE_SESSION_COUNT = "remote_active_session_count";
const REMOTE_USAGE_EVENT_DISCONNECT = "remote_disconnect";
const REMOTE_USAGE_GAUGE_INTERVAL_MS = 300_000;

export interface RemoteConnectionStats {
  activeSessionCount: number;
  activeTargetCount: number;
}

export type RemoteGaugeTransition =
  | "connected"
  | "connection-closed"
  | "disposed"
  | "window-closed"
  | "host-exit"
  | "app-shutdown"
  | "none";

export type RemoteDisconnectReason = Exclude<RemoteGaugeTransition, "connected" | "none">;

interface RemoteUsageTelemetryConfig {
  telemetryCustomContext: {
    deviceMid: string;
    platform: NodeJS.Platform;
    appVersion: string;
    telemetryEnv: TelemetryEnvLabel;
  };
  getRemoteConnectionStats: () => RemoteConnectionStats;
  sendCustom: (payload: FinalCustomTelemetryEventPayload) => void;
  e2eController?: FinalCustomTelemetryEventE2EController | null;
  logger: { warn: (...args: unknown[]) => void };
  setInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
}

let telemetryConfig: RemoteUsageTelemetryConfig | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let lastGaugeRendererId: number | null = null;

function buildRemoteConnectResultTelemetryPayload(params: {
  result: RemoteUsageResult;
  remoteKind: RemoteUsageRemoteKind;
  connectTrigger: RemoteWorkspaceConnectTrigger;
  errorCategory?: RemoteUsageErrorCategory;
}): CustomTelemetryEventPayload {
  return {
    name: REMOTE_USAGE_EVENT_CONNECT_RESULT,
    group: REMOTE_USAGE_TELEMETRY_GROUP,
    value: 1,
    properties: {
      result: params.result,
      remote_kind: params.remoteKind,
      connect_trigger: params.connectTrigger,
      error_category: params.result === "success" ? "" : (params.errorCategory ?? "unknown"),
    },
  };
}

function buildRemoteActiveSessionCountTelemetryPayload(
  params: {
    sampleReason: "state-change" | "periodic";
    transition: RemoteGaugeTransition;
    remoteKind?: RemoteUsageRemoteKind;
  },
  stats: RemoteConnectionStats,
): CustomTelemetryEventPayload {
  return {
    name: REMOTE_USAGE_EVENT_ACTIVE_SESSION_COUNT,
    group: REMOTE_USAGE_TELEMETRY_GROUP,
    value: stats.activeSessionCount,
    properties: {
      sample_reason: params.sampleReason,
      transition: params.transition,
      remote_kind: params.remoteKind ?? "",
      active_target_count: stats.activeTargetCount,
    },
  };
}

function buildRemoteDisconnectTelemetryPayload(params: {
  remoteKind: RemoteUsageRemoteKind;
  disconnectReason: RemoteDisconnectReason;
  durationMs: number;
}): CustomTelemetryEventPayload {
  return {
    name: REMOTE_USAGE_EVENT_DISCONNECT,
    group: REMOTE_USAGE_TELEMETRY_GROUP,
    value: params.durationMs,
    properties: {
      remote_kind: params.remoteKind,
      disconnect_reason: params.disconnectReason,
      duration_ms: params.durationMs,
    },
  };
}

export function configureRemoteUsageTelemetry(config: RemoteUsageTelemetryConfig): void {
  stopRemoteUsagePeriodicSampling();
  telemetryConfig = config;
  const schedule = config.setInterval ?? setInterval;
  periodicTimer = schedule(reportPeriodicGauge, REMOTE_USAGE_GAUGE_INTERVAL_MS);
  periodicTimer.unref?.();
}

function dispatchSafely(rendererId: number, payload: CustomTelemetryEventPayload): void {
  const config = telemetryConfig;
  if (!config) return;
  try {
    dispatchFinalCustomTelemetryEvent({
      payload,
      context: { ...config.telemetryCustomContext, rendererId },
      e2eController: config.e2eController,
      sendCustom: config.sendCustom,
    });
  } catch (error) {
    config.logger.warn("[remote-usage-telemetry] dispatch failed", {
      eventName: payload.name,
      error,
    });
  }
}

export function reportRemoteConnectResultTelemetry(params: {
  rendererId: number;
  result: RemoteUsageResult;
  remoteKind: RemoteUsageRemoteKind;
  connectTrigger: RemoteWorkspaceConnectTrigger;
  errorCategory?: RemoteUsageErrorCategory;
}): void {
  dispatchSafely(params.rendererId, buildRemoteConnectResultTelemetryPayload(params));
}

function reportGauge(params: {
  rendererId: number;
  sampleReason: "state-change" | "periodic";
  transition: RemoteGaugeTransition;
  remoteKind?: RemoteUsageRemoteKind;
}): void {
  const config = telemetryConfig;
  if (!config) return;
  try {
    const stats = config.getRemoteConnectionStats();
    dispatchSafely(params.rendererId, buildRemoteActiveSessionCountTelemetryPayload(params, stats));
  } catch (error) {
    config.logger.warn("[remote-usage-telemetry] read stats failed", { error });
  }
}

function reportPeriodicGauge(): void {
  const config = telemetryConfig;
  if (!config || lastGaugeRendererId == null) return;
  try {
    const stats = config.getRemoteConnectionStats();
    if (stats.activeSessionCount <= 0) return;
    dispatchSafely(
      lastGaugeRendererId,
      buildRemoteActiveSessionCountTelemetryPayload(
        { sampleReason: "periodic", transition: "none" },
        stats,
      ),
    );
  } catch (error) {
    config.logger.warn("[remote-usage-telemetry] periodic stats failed", { error });
  }
}

export function reportRemoteConnectionStateChangedTelemetry(params: {
  rendererId: number;
  transition: Exclude<RemoteGaugeTransition, "none">;
  remoteKind: RemoteUsageRemoteKind;
}): void {
  if (!telemetryConfig) return;
  lastGaugeRendererId = params.rendererId;
  reportGauge({
    ...params,
    sampleReason: "state-change",
  });
}

export function reportRemoteDisconnectTelemetry(params: {
  rendererId: number;
  remoteKind: RemoteUsageRemoteKind;
  disconnectReason: RemoteDisconnectReason;
  durationMs: number;
}): void {
  dispatchSafely(params.rendererId, buildRemoteDisconnectTelemetryPayload(params));
}

export function stopRemoteUsagePeriodicSampling(): void {
  const timer = periodicTimer;
  if (!timer) return;
  (telemetryConfig?.clearInterval ?? clearInterval)(timer);
  periodicTimer = null;
}
