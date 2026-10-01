/**
 * 「我的额度」用量图表：近 N 天每日消耗积分（柱）+ 缓存命中率（折线）。
 *
 * 数据来自 IProviderQuotaService.getUsageDaily：后端只返回**有记录**的日期，不补零。
 * 这里按返回区间补齐缺失日（不按客户端"今天"推算，避免时区把最后一天算错）。
 */
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import type { QuotaUsageDay } from "@zcode/services";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const CHART_MARGIN = { top: 8, right: 8, left: 8 } as const;
/** 缓存命中率是百分比，右轴固定 0..100，否则折线会随当日值自动缩放而失真。 */
const CACHE_AXIS_DOMAIN: [number, number] = [0, 100];

export const QUOTA_USAGE_CHART_CONFIG = {
  charged: {
    label: "charged",
    theme: { light: "#4f7cff", dark: "#7aa2ff" },
  },
  cacheHitRate: {
    label: "cacheHitRate",
    theme: { light: "#d97706", dark: "#f2b03d" },
  },
} satisfies ChartConfig;

export interface QuotaUsageChartRow {
  readonly label: string;
  readonly charged: number;
  readonly requests: number | null;
  readonly cacheHitRate: number | null;
}

function parseDayKey(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 把稀疏的后端序列对齐成连续日历（缺失日补 0），保证柱子间距就是真实的天数。 */
export function buildQuotaUsageChartRows(
  usage: readonly QuotaUsageDay[],
): readonly QuotaUsageChartRow[] {
  const byDate = new Map<string, QuotaUsageDay>();
  for (const day of usage) {
    if (parseDayKey(day.date) !== null) byDate.set(day.date, day);
  }
  const keys = [...byDate.keys()].sort();
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return [];
  const startMs = parseDayKey(first);
  const endMs = parseDayKey(last);
  if (startMs === null || endMs === null) return [];

  const rows: QuotaUsageChartRow[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const key = formatDayKey(ms);
    const day = byDate.get(key);
    rows.push({
      label: key.slice(5),
      charged: day?.charged ?? 0,
      requests: day?.requests ?? null,
      cacheHitRate: day?.cacheHitRate ?? null,
    });
  }
  return rows;
}

export interface QuotaUsageSummary {
  readonly dayCount: number;
  readonly totalCharged: number;
  readonly totalRequests: number;
  readonly averageCacheHitRate: number | null;
}

/** 汇总卡片用的口径：命中率只在有采样的天上平均，缺采样的天不按 0 计入。 */
export function summarizeQuotaUsage(usage: readonly QuotaUsageDay[]): QuotaUsageSummary {
  let totalCharged = 0;
  let totalRequests = 0;
  let hitRateSum = 0;
  let hitRateDays = 0;
  let dayCount = 0;
  for (const day of usage) {
    dayCount += 1;
    totalCharged += day.charged ?? 0;
    totalRequests += day.requests ?? 0;
    if (typeof day.cacheHitRate === "number" && Number.isFinite(day.cacheHitRate)) {
      hitRateSum += day.cacheHitRate;
      hitRateDays += 1;
    }
  }
  return {
    dayCount,
    totalCharged,
    totalRequests,
    averageCacheHitRate: hitRateDays > 0 ? hitRateSum / hitRateDays : null,
  };
}

export function NimbusQuotaUsageChart({ usage }: { usage: readonly QuotaUsageDay[] }) {
  const { intl } = useZCodeIntl();
  const rows = useMemo(() => buildQuotaUsageChartRows(usage), [usage]);
  const config = useMemo(
    () =>
      ({
        charged: {
          ...QUOTA_USAGE_CHART_CONFIG.charged,
          label: intl.formatMessage({ id: "business.quota.usageCharged" }),
        },
        cacheHitRate: {
          ...QUOTA_USAGE_CHART_CONFIG.cacheHitRate,
          label: intl.formatMessage({ id: "business.quota.usageCacheHit" }),
        },
      }) satisfies ChartConfig,
    [intl],
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-lg bg-surface px-3 py-6 text-center text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "business.quota.usageEmpty" })}
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <ComposedChart accessibilityLayer data={[...rows]} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis yAxisId="charged" hide />
        <YAxis yAxisId="cache" hide orientation="right" domain={CACHE_AXIS_DOMAIN} />
        {/* 必须以元素形式传入：Recharts 的 content 类型不接受带 DOM props 的组件引用。 */}
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          yAxisId="charged"
          dataKey="charged"
          fill="var(--color-charged)"
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="cache"
          dataKey="cacheHitRate"
          type="monotone"
          stroke="var(--color-cacheHitRate)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  );
}
