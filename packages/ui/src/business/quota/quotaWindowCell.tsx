/**
 * 用量窗口迷你卡：标签 + 右侧百分比 + 细进度条 + 已用/上限。
 *
 * 官方计划面板同款结构（5 小时窗 / 周窗并排各占一列），与主进度条形成两级视觉：
 * 主条粗（剩余额度总量），窗口条细（次级配额）。字段缺失的窗口整卡不渲染。
 */
import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";
import { percentOf } from "./quotaFormat.js";

export function QuotaWindowCell({
  label,
  used,
  limit,
  remaining: customRemaining,
  badge,
  indicatorColor = "var(--color-usage-chart-1, #0b7fff)",
}: {
  label: string;
  used: number | null;
  limit: number | null;
  remaining?: number | null;
  badge?: string | null;
  indicatorColor?: string;
}) {
  if (limit === null || limit <= 0) return null;
  const remaining = customRemaining ?? (used !== null ? Math.max(0, limit - used) : null);
  if (remaining === null) return null;
  const percent = percentOf(remaining, limit);

  return (
    <div className="min-w-0" data-quota-window-cell="">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-ui-caption font-medium text-foreground">{label}</span>
          {badge ? (
            <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-ui-xs font-medium leading-none text-emerald-600 dark:text-emerald-400">
              {badge}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 font-medium text-ui-xs tabular-nums text-foreground">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover/80 my-1.5">
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%`, backgroundColor: indicatorColor }}
        />
      </div>
      <div className="truncate font-mono text-ui-xs tabular-nums text-foreground-subtle">
        <span className="font-medium text-foreground">{Math.round(remaining).toLocaleString()}</span>
        {" / "}
        {Math.round(limit).toLocaleString()} 积分
      </div>
    </div>
  );
}

/** 紧凑仪表卡单元：对齐额度仪表设计（顶部标签 + 中间数值/辅助信息 + 底部彩色细条）。
 * percent=null 表示该项没有总量概念（如钱包余额）——不渲染进度条，只有数值。 */
export function QuotaMeterCell({
  label,
  value,
  subValue,
  badge,
  percent,
  color,
}: {
  label: string;
  value: string;
  subValue?: string | null;
  badge?: string | null;
  percent: number | null;
  color: string;
}) {
  const boundedPercent = percent === null ? null : Math.min(Math.max(percent, 0), 100);
  return (
    <div className="flex min-w-0 flex-col" data-quota-meter-cell="">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="truncate text-ui-sm text-foreground-subtle">{label}</span>
        {badge ? (
          <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-ui-xs font-medium leading-none text-emerald-600 dark:text-emerald-400">
            {badge}
          </span>
        ) : null}
      </div>
      {/* 数值与重置时间同行展示；外层不 truncate、时间不省略——
          320px 弹窗里「02:31 后重置」曾被 … 吞掉（用户实测）。标签过长时
          让位的顺序：标签截断，数值/时间始终完整。 */}
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-ui-sm font-normal tabular-nums text-foreground">{value}</span>
        {subValue ? (
          <span className="whitespace-nowrap text-ui-xs tabular-nums text-foreground-subtle">
            · {subValue}
          </span>
        ) : null}
      </div>
      {boundedPercent !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover/80">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${boundedPercent}%`, backgroundColor: color }}
          />
        </div>
      ) : (
        <div className="h-1.5" />
      )}
    </div>
  );
}

/** 仪表卡网格容器：自适应 1~3 列。 */
export function QuotaMeterGrid({
  children,
  columns = 3,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const gridColsClass =
    columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-3";
  return <div className={cn("grid gap-2.5", gridColsClass)}>{children}</div>;
}

/** 双列并排容器：5 小时窗 + 周窗（不足两张时退化为单列宽度）。 */
export function QuotaWindowGrid({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={compact ? "grid grid-cols-2 gap-x-3 gap-y-2" : "grid grid-cols-2 gap-x-4 gap-y-3"}>
      {children}
    </div>
  );
}

