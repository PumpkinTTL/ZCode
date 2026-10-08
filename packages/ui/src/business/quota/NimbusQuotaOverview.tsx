/* eslint-disable max-lines -- 额度面板聚合视图：账户/窗口/签到/图表/网页端引用天然同屏，拆文件破坏内聚。 */
/**
 * 「我的额度」已登录面板：账户头 + 剩余额度主卡（含账户概览行）+ 套餐卡 + 近 30 天用量图表。
 *
 * 视觉语言与官方计划面板同源：标题行（左标题 + 右等宽数值）、单色进度条
 * （主条 h-2.5，窗口迷你卡内细条 h-1.5）、「圆点 + 标签 + 右对齐数值」行式概览、
 * border-t 附注行。层级只有「主条 → 窗口迷你卡 → 附注」一层，不做彩色分栏与多卡堆叠。
 *
 * 面板本体是数据驱动的只读视图，登录入口由设置页自动弹 WelcomeScreen 承接。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuotaStatusResult, QuotaUsageDay } from "@zcode/services";
import { Gift, Loader2, LogOut, Plus, RefreshCw, RotateCcw, SquareArrowOutUpRight } from "lucide-react";
import { NimbusQuotaUsageChart, summarizeQuotaUsage } from "./NimbusQuotaUsageChart.js";
import { NimbusRechargeDialog } from "./NimbusRechargeDialog.js";
import { NimbusResetCardsDialog } from "./NimbusResetCardsDialog.js";
import { NimbusCheckinCard } from "./NimbusCheckinCard.js";
import { formatQuotaPlanName, percentOf } from "./quotaFormat.js";
import { useNimbusAccountState } from "./nimbusAccountState.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Progress } from "@/components/ui/progress.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;
const USAGE_DAYS = 30;

function formatInt(v: number) {
  // 用户要求裸数字：不加千分位逗号（705174，而不是 705,174）。
  return String(Math.round(v));
}

export function NimbusQuotaOverview({
  status,
  busy,
  onRefresh,
  onLogout,
}: {
  status: LoggedInStatus;
  busy: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const accountState = useNimbusAccountState();
  const resetCardCount = accountState.resetCardCount;

  const [usage, setUsage] = useState<readonly QuotaUsageDay[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [resetCardsOpen, setResetCardsOpen] = useState(false);
  // Web 门户引用：完整用量明细/流水在网页端看，APP 只留核心数据（与额度服务同源）。
  const [portalUsageUrl, setPortalUsageUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void providerQuotaService
      .getBaseUrl()
      .then((base) => {
        if (alive) setPortalUsageUrl(`${base.trim().replace(/\/+$/u, "")}/usage`);
      })
      .catch(() => {
        // 拿不到 base 就不渲染引用行，静默即可。
      });
    return () => {
      alive = false;
    };
  }, [providerQuotaService]);

  const loadUsage = useCallback(async () => {
    setUsageError(null);
    try {
      setUsage(await providerQuotaService.getUsageDaily(USAGE_DAYS));
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : String(error));
      setUsage([]);
    }
  }, [providerQuotaService]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const summary = useMemo(() => summarizeQuotaUsage(usage ?? []), [usage]);

  const wallet = status.account.wallet;
  const creditsSub = status.subscriptions.find((s) => s.kind === "credits");
  const perCallSub = status.subscriptions.find((s) => s.kind === "per_call");

  const averageCacheHitRate =
    summary.averageCacheHitRate === null ? "—" : `${summary.averageCacheHitRate.toFixed(1)}%`;

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const activeSub = creditsSub ?? perCallSub;
  const rawExpiresAt = activeSub?.expiresAt ?? 0;
  const hoursLeft = activeSub?.hoursLeft ?? 0;
  const effectiveExpiresAt =
    rawExpiresAt > 1577836800000
      ? rawExpiresAt
      : hoursLeft > 0
        ? Date.now() + hoursLeft * 3600 * 1000
        : 0;

  // 5 小时窗配额
  const remaining5h =
    creditsSub?.limit5h !== null && creditsSub?.limit5h !== undefined && creditsSub.limit5h > 0
      ? Math.max(0, creditsSub.limit5h - (creditsSub.used5h ?? 0))
      : null;
  const percent5h =
    remaining5h !== null && creditsSub?.limit5h ? percentOf(remaining5h, creditsSub.limit5h) : 100;

  // 周配额
  const remainingWeekly =
    creditsSub?.limitWeekly !== null &&
    creditsSub?.limitWeekly !== undefined &&
    creditsSub.limitWeekly > 0
      ? Math.max(0, creditsSub.limitWeekly - (creditsSub.usedWeekly ?? 0))
      : null;
  const percentWeekly =
    remainingWeekly !== null && creditsSub?.limitWeekly
      ? percentOf(remainingWeekly, creditsSub.limitWeekly)
      : 100;

  // 重置时刻（绝对时间，官方同款「10/14 21:46」口径）；0 = 空窗/未锚定不显示。
  const formatResetMoment = (resetAtMs: number): string => {
    if (!(resetAtMs > 0)) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(resetAtMs);
  };

  // 套餐到期倒计时（天）；0/未配置 = 不显示。
  const daysLeft =
    effectiveExpiresAt > 0
      ? Math.max(0, Math.ceil((effectiveExpiresAt - Date.now()) / 86400000))
      : null;

  // 用户头像简写
  const userInitials = (status.account.username || "AD").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4" data-quota-overview="">
      {/* 1. 一体化账户与额度总看板：全局严格 px-6 贯穿对齐 */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        {/* 1.1 顶栏：用户身份（左）与操作按钮（右） */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-6 py-5">
          {/* 左侧：身份信息 */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-surface text-ui-base font-bold text-foreground select-none">
              {userInitials}
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="truncate text-ui-lg font-bold text-foreground">
                  {status.account.username}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium leading-none text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {intl.formatMessage({ id: "business.quota.online" })}
                </span>
                {activeSub ? (
                  <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-ui-xs font-semibold leading-none text-primary">
                    {formatQuotaPlanName(activeSub.planName)}
                  </span>
                ) : null}
              </div>
              {status.account.emailMasked ? (
                <div className="truncate text-ui-sm text-foreground-subtle">
                  {status.account.emailMasked}
                </div>
              ) : null}
            </div>
          </div>

          {/* 右侧：全局操作按钮组 */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="h-8 rounded-lg px-3 text-ui-sm font-medium cursor-pointer"
              onClick={() => {
                onRefresh();
                void loadUsage();
              }}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              {intl.formatMessage({ id: "business.quota.refresh" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              className="h-8 rounded-lg px-3 text-ui-sm text-foreground-subtle hover:text-foreground cursor-pointer"
              onClick={onLogout}
            >
              <LogOut className="size-3.5 mr-1.5" />
              {intl.formatMessage({ id: "business.quota.logout" })}
            </Button>
          </div>
        </div>

        {/* 1.2 中栏：套餐状态与操作横条 */}
        <div className="border-t border-border/60 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-surface/20">
          <div className="flex items-center gap-2.5">
            <h4 className="text-ui-base font-semibold text-foreground">
              {intl.formatMessage({ id: "business.quota.subscriptions" })}
            </h4>
            {resetCardCount > 0 ? (
              <button
                type="button"
                title={intl.formatMessage({ id: "business.quota.resetCardBadgeTitle" })}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-ui-xs font-medium text-emerald-700 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/15 active:bg-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 cursor-pointer select-none"
                onClick={() => setResetCardsOpen(true)}
              >
                <Gift aria-hidden="true" className="size-3 text-emerald-600 dark:text-emerald-400" />
                <span>
                  {intl.formatMessage(
                    { id: "business.quota.resetCardBadge" },
                    { count: resetCardCount },
                  )}
                </span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-ui-sm text-foreground-subtle">
              {effectiveExpiresAt > 0
                ? `${intl.formatMessage(
                    { id: "business.quota.validUntil" },
                    { date: dateFmt.format(effectiveExpiresAt) },
                  )}${daysLeft !== null ? ` · ${intl.formatMessage({ id: "business.quota.daysLeft" }, { days: daysLeft })}` : ""}`
                : "滚动调用限额"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-lg px-2.5 text-ui-sm font-medium cursor-pointer gap-1.5 text-foreground-subtle hover:text-foreground"
              onClick={() => setResetCardsOpen(true)}
            >
              <RotateCcw className="size-3.5" />
              <span>{intl.formatMessage({ id: "business.quota.resetCardsTitle" })}</span>
            </Button>
          </div>
        </div>

        {/* 1.3 核心：统一三列垂直严密对齐栅格系统（1:1:1 竖向贯穿对齐） */}
        <div className="px-6 py-6 border-t border-border/60">
          {creditsSub ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 第 1 列：5 小时调用窗口 ➔ 今日已用 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">5 小时调用窗口</span>
                    <span className="tabular-nums">
                      <span className="font-bold text-foreground">{formatInt(remaining5h ?? 0)}</span>
                      <span className="text-foreground-subtle text-ui-sm">
                        {" "}/ {formatInt(creditsSub.limit5h ?? 0)}
                      </span>
                      <span className="text-ui-sm font-medium text-blue-600 dark:text-blue-400 ml-1">
                        ({Math.round(percent5h)}%)
                      </span>
                    </span>
                  </div>
                  <Progress
                    className="h-2.5 rounded-full bg-surface-hover/80"
                    value={percent5h}
                    indicatorClassName="bg-blue-600 dark:bg-blue-500 rounded-full"
                  />
                  <div className="flex items-center justify-between text-ui-sm text-foreground-subtle">
                    <span>
                      {creditsSub.next5hRefreshAt > 0
                        ? `${formatResetMoment(creditsSub.next5hRefreshAt)} 重置`
                        : "滚动更新"}
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.todaySpend" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {formatInt(wallet.todaySpend)}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">积分</span>
                  </div>
                </div>
              </div>

              {/* 第 2 列：本周调用窗口 ➔ 本月已用 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">本周调用窗口</span>
                    <span className="tabular-nums">
                      <span className="font-bold text-foreground">{formatInt(remainingWeekly ?? 0)}</span>
                      <span className="text-foreground-subtle text-ui-sm">
                        {" "}/ {formatInt(creditsSub.limitWeekly ?? 0)}
                      </span>
                      <span className="text-ui-sm font-medium text-indigo-600 dark:text-indigo-400 ml-1">
                        ({Math.round(percentWeekly)}%)
                      </span>
                    </span>
                  </div>
                  <Progress
                    className="h-2.5 rounded-full bg-surface-hover/80"
                    value={percentWeekly}
                    indicatorClassName="bg-indigo-600 dark:bg-indigo-500 rounded-full"
                  />
                  <div className="flex items-center justify-between text-ui-sm text-foreground-subtle">
                    <span>
                      {creditsSub.nextWeekResetAt > 0
                        ? `${formatResetMoment(creditsSub.nextWeekResetAt)} 重置`
                        : "按周更新"}
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.monthSpend" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {formatInt(wallet.monthSpend)}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">积分</span>
                  </div>
                </div>
              </div>

              {/* 第 3 列：钱包余额 ➔ 平均缓存命中率 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">钱包余额</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-ui-lg font-bold tabular-nums text-foreground tracking-tight">
                        {formatInt(wallet.available)}
                      </span>
                      <span className="text-ui-sm text-foreground-subtle">积分</span>
                    </div>
                  </div>
                  {/* 与进度条高度对称的操作行 */}
                  <div className="flex items-center justify-between h-2.5">
                    {wallet.lowBalance ? (
                      <span className="text-ui-xs font-medium text-amber-500">
                        {intl.formatMessage({ id: "business.quota.lowBalance" })}
                      </span>
                    ) : (
                      <span className="text-ui-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        余额正常
                      </span>
                    )}
                    {wallet.rechargeEnabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 -my-2 rounded-md px-2.5 text-ui-xs font-medium cursor-pointer"
                        onClick={() => setRechargeOpen(true)}
                      >
                        <Plus className="size-3 mr-1" />
                        {intl.formatMessage({ id: "business.quota.recharge" })}
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between text-ui-sm text-foreground-subtle">
                    <span>基础额度账户</span>
                  </div>
                </div>

                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.avgCacheHitRate" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {averageCacheHitRate}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : perCallSub ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 第 1 列：剩余调用次数 ➔ 今日已用 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">剩余调用次数</span>
                    <span className="font-bold tabular-nums text-foreground">
                      {perCallSub.remainingCalls ?? perCallSub.remaining} / {perCallSub.totalCalls} 次
                    </span>
                  </div>
                  <Progress
                    className="h-2.5 rounded-full bg-surface-hover/80"
                    value={percentOf(
                      perCallSub.remainingCalls ?? perCallSub.remaining,
                      perCallSub.totalCalls,
                    )}
                    indicatorClassName="bg-blue-600 dark:bg-blue-500 rounded-full"
                  />
                  <div className="text-ui-sm text-foreground-subtle">按次消耗模式</div>
                </div>
                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.todaySpend" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {formatInt(wallet.todaySpend)}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">积分</span>
                  </div>
                </div>
              </div>

              {/* 第 2 列：有效期限 ➔ 本月已用 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">有效期限</span>
                    <span className="text-ui-sm text-foreground-subtle">
                      {effectiveExpiresAt > 0 ? dateFmt.format(effectiveExpiresAt) : "长期有效"}
                    </span>
                  </div>
                  <div className="h-2.5" />
                  <div className="text-ui-sm text-foreground-subtle">
                    {daysLeft !== null ? `剩余 ${daysLeft} 天` : "未激活"}
                  </div>
                </div>
                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.monthSpend" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {formatInt(wallet.monthSpend)}
                    </span>
                    <span className="text-ui-xs text-foreground-subtle">积分</span>
                  </div>
                </div>
              </div>

              {/* 第 3 列：钱包余额 ➔ 缓存命中率 */}
              <div className="flex flex-col justify-between space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-ui-base">
                    <span className="font-semibold text-foreground">钱包余额</span>
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {formatInt(wallet.available)} 积分
                    </span>
                  </div>
                  <div className="h-2.5" />
                  <div className="text-ui-sm text-foreground-subtle">基础额度账户</div>
                </div>
                <div className="border-t border-border/60 pt-3.5">
                  <span className="text-ui-sm text-foreground-subtle">
                    {intl.formatMessage({ id: "business.quota.avgCacheHitRate" })}
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-ui-lg font-bold tabular-nums text-foreground">
                      {averageCacheHitRate}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "business.quota.noSubscription" })}
            </p>
          )}
        </div>

        {/* 1.4 底栏：每日签到（严格对齐 px-6） */}
        <NimbusCheckinCard embedded />
      </div>

      {/* 2. 近 30 天用量趋势：严格对齐 p-6 */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ui-base font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.usageChartTitle" }, { days: USAGE_DAYS })}
          </span>
          <span className="text-ui-sm tabular-nums text-foreground-subtle">
            {intl.formatMessage(
              { id: "business.quota.usageTotal" },
              { value: formatInt(summary.totalCharged) },
            )}
          </span>
        </div>
        {usageError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {intl.formatMessage({ id: "business.quota.usageLoadFailed" })}
            </AlertDescription>
          </Alert>
        ) : usage === null ? (
          <div className="flex h-44 items-center justify-center text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <NimbusQuotaUsageChart usage={usage} />
        )}
      </div>

      {/* 网页端引用：严格右对齐 */}
      {portalUsageUrl ? (
        <div className="flex justify-end pt-1">
          <a
            href={portalUsageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-ui-sm text-foreground-subtle transition-colors hover:text-foreground"
          >
            {intl.formatMessage({ id: "business.quota.webPortalUsage" })}
            <SquareArrowOutUpRight className="size-3.5" />
          </a>
        </div>
      ) : null}

      {/* 充值弹窗 */}
      <NimbusRechargeDialog
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        creditsPerYuan={wallet.creditsPerYuan}
      />

      {/* 重置卡弹窗 */}
      <NimbusResetCardsDialog
        open={resetCardsOpen}
        onClose={() => setResetCardsOpen(false)}
        status={status}
      />
    </div>
  );
}
