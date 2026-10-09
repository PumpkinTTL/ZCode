import { useRef } from "react";
import {
  getZCodeBackgroundTaskControlItemElapsedMs,
  type ZCodeBackgroundTaskControlItem,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

// 陈旧条目防御（纯展示）：host 冷恢复可能把很久以前误判为 running 的子代理/
// 后台任务带回投影（核心链路的已知边界，见 subagent-session-query 的 running
// 兜底），如实渲染会出现「已运行 3 万分钟」。超过 24 小时统一显示「> 24 小时」
// ——只收显示口径，不改数据、计数与条目可见性。
const ELAPSED_DISPLAY_CAP_MS = 24 * 60 * 60 * 1000;

export function formatBackgroundTaskElapsedLabel(
  elapsedMs: number,
  formatMessage: ReturnType<typeof useZCodeIntl>["intl"]["formatMessage"],
) {
  if (elapsedMs > ELAPSED_DISPLAY_CAP_MS) {
    return formatMessage({ id: "chat.longRunning.elapsedOverCap" }, { hours: "24" });
  }
  const totalSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return formatMessage(
      { id: "chat.longRunning.elapsedMinutesSeconds" },
      { minutes: String(minutes), seconds: String(seconds) },
    );
  }

  return formatMessage(
    { id: "chat.longRunning.elapsedSeconds" },
    { seconds: String(totalSeconds) },
  );
}

function createElapsedBaseline(job: ZCodeBackgroundTaskControlItem) {
  const mountedAt = Date.now();
  return {
    elapsedMs: getZCodeBackgroundTaskControlItemElapsedMs(job, mountedAt),
    key: `${job.jobId}:${job.startedAt ?? "no-start"}:${job.elapsedMs ?? "no-elapsed"}`,
    mountedAt,
  };
}

function elapsedMsForClock(input: {
  baseline: ReturnType<typeof createElapsedBaseline>;
  job: ZCodeBackgroundTaskControlItem;
  now: number;
}) {
  const elapsedFromJob = getZCodeBackgroundTaskControlItemElapsedMs(input.job, input.now);
  const elapsedFromBaseline =
    input.baseline.elapsedMs + Math.max(0, input.now - input.baseline.mountedAt);
  return Math.max(elapsedFromJob, elapsedFromBaseline);
}

export function BackgroundTaskElapsedLabel({
  className,
  job,
  now = Date.now(),
}: {
  className?: string;
  job: ZCodeBackgroundTaskControlItem;
  now?: number;
}) {
  const { intl } = useZCodeIntl();
  const baselineRef = useRef<ReturnType<typeof createElapsedBaseline> | null>(null);
  const baselineKey = `${job.jobId}:${job.startedAt ?? "no-start"}:${job.elapsedMs ?? "no-elapsed"}`;
  if (!baselineRef.current || baselineRef.current.key !== baselineKey) {
    baselineRef.current = createElapsedBaseline(job);
  }
  const baseline = baselineRef.current;

  return (
    <span className={cn("shrink-0 tabular-nums text-foreground-subtle", className)}>
      {formatBackgroundTaskElapsedLabel(
        elapsedMsForClock({
          baseline,
          job,
          now,
        }),
        intl.formatMessage,
      )}
    </span>
  );
}
