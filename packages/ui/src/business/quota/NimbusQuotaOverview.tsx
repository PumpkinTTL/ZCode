/**
 * 「我的额度」已登录面板：账户头 + 剩余额度主卡（含账户概览行）+ 套餐卡 + 近 30 天用量图表。
 *
 * 视觉语言与官方计划面板同源：标题行（左标题 + 右等宽数值）、单色进度条
 * （主条 h-2.5，窗口迷你卡内细条 h-1.5）、「圆点 + 标签 + 右对齐数值」行式概览、
 * border-t 附注行。层级只有「主条 → 窗口迷你卡 → 附注」一层，不做彩色分栏与多卡堆叠。
 *
 * 面板本体是数据驱动的只读视图，登录/登出仍由 NimbusAccountDialog 负责。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuotaStatusResult, QuotaUsageDay } from "@zcode/services";
import { Loader2, LogOut, Plus, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { NimbusQuotaUsageChart, summarizeQuotaUsage } from "./NimbusQuotaUsageChart.js";
import { NimbusRechargeDialog } from "./NimbusRechargeDialog.js";
import { NimbusCheckinCard } from "./NimbusCheckinCard.js";
import { formatQuotaPlanName, percentOf } from "./quotaFormat.js";
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
  const [usage, setUsage] = useState<readonly QuotaUsageDay[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
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
      {/* 1. 顶部账户卡：身份 + 钱包余额（合入）+ 操作。周期总额度不再展示。 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-ui-sm font-semibold text-primary">
              {userInitials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-ui-base font-semibold text-foreground">
                  {status.account.username}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {intl.formatMessage({ id: "business.quota.online" })}
                </span>
                {activeSub ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-ui-xs font-medium text-primary">
                    {formatQuotaPlanName(activeSub.planName)}
                  </span>
                ) : null}
              </div>
              {status.account.emailMasked ? (
                <div className="mt-0.5 truncate text-ui-xs text-foreground-subtle">
                  {status.account.emailMasked}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tabular-nums text-foreground tracking-tight">
                {formatInt(wallet.available)}
              </span>
              {wallet.lowBalance ? (
                <span className="text-ui-xs font-medium text-amber-500">
                  {intl.formatMessage({ id: "business.quota.lowBalance" })}
                </span>
              ) : (
                <span className="text-ui-sm text-foreground-subtle">钱包余额</span>
              )}
              {/* 充值入口：总开关由后端 /user/me 下发（recharge_enabled），关闭时不渲染。 */}
              {wallet.rechargeEnabled ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => setRechargeOpen(true)}
                >
                  <Plus className="size-3.5 mr-1" />
                  {intl.formatMessage({ id: "business.quota.recharge" })}
                </Button>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="cursor-pointer"
                onClick={() => {
                  onRefresh();
                  void loadUsage();
                }}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="size-3.5 mr-1" />
                )}
                {intl.formatMessage({ id: "business.quota.refresh" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="cursor-pointer text-foreground-subtle hover:text-foreground"
                onClick={onLogout}
              >
                <LogOut className="size-3.5 mr-1" />
                {intl.formatMessage({ id: "business.quota.logout" })}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-ui-xs">
          <span className="text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.todaySpend" })}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatInt(wallet.todaySpend)}
            </span>
          </span>
          <span className="text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.monthSpend" })}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatInt(wallet.monthSpend)}
            </span>
          </span>
          <span className="text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.avgCacheHitRate" })}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {averageCacheHitRate}
            </span>
          </span>
        </div>
      </div>

      {/* 1.5 每日签到：连签天数 + 今日签到入口；状态/失败降级由卡片自隐藏。 */}
      <NimbusCheckinCard />

      {/* 2. 我的套餐：滚动调用窗口与重置时间。周期总额度不再向用户展示。 */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-center justify-between">
          <h4 className="text-ui-sm font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.subscriptions" })}
          </h4>
          <span className="text-ui-xs text-foreground-subtle">
            {effectiveExpiresAt > 0
              ? `${intl.formatMessage(
                  { id: "business.quota.validUntil" },
                  { date: dateFmt.format(effectiveExpiresAt) },
                )}${daysLeft !== null ? ` · ${intl.formatMessage({ id: "business.quota.daysLeft" }, { days: daysLeft })}` : ""}`
              : "滚动调用限额"}
          </span>
        </div>

        {creditsSub ? (
          <div className="space-y-3.5">
            {remaining5h !== null && creditsSub.limit5h !== null ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-ui-sm">
                  <span className="flex items-center gap-1.5 text-foreground">
                    5 小时调用窗口
                    <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-ui-xs font-medium leading-none text-emerald-600 dark:text-emerald-400">
                      重置
                    </span>
                  </span>
                  <span className="tabular-nums text-foreground">
                    <span className="font-medium">{formatInt(remaining5h)}</span> /{" "}
                    {formatInt(creditsSub.limit5h)}{" "}
                    <span className="text-foreground-subtle text-ui-xs">
                      ({Math.round(percent5h)}%)
                    </span>
                  </span>
                </div>
                <Progress
                  className="h-1.5 rounded-full bg-surface-hover/80"
                  value={percent5h}
                  indicatorClassName="bg-[#0b7fff] dark:bg-[#4099ff] rounded-full"
                />
                {creditsSub.next5hRefreshAt > 0 ? (
                  <p className="text-ui-xs text-foreground-subtle">
                    {formatResetMoment(creditsSub.next5hRefreshAt)} 重置 5 小时额度
                  </p>
                ) : null}
              </div>
            ) : null}

            {remainingWeekly !== null && creditsSub.limitWeekly !== null ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-ui-sm">
                  <span className="text-foreground">本周调用窗口</span>
                  <span className="tabular-nums text-foreground">
                    <span className="font-medium">{formatInt(remainingWeekly)}</span> /{" "}
                    {formatInt(creditsSub.limitWeekly)}{" "}
                    <span className="text-foreground-subtle text-ui-xs">
                      ({Math.round(percentWeekly)}%)
                    </span>
                  </span>
                </div>
                <Progress
                  className="h-1.5 rounded-full bg-surface-hover/80"
                  value={percentWeekly}
                  indicatorClassName="bg-[#9e77ed] rounded-full"
                />
                {creditsSub.nextWeekResetAt > 0 ? (
                  <p className="text-ui-xs text-foreground-subtle">
                    {formatResetMoment(creditsSub.nextWeekResetAt)} 重置本周额度
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : perCallSub ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-ui-sm">
              <span className="text-foreground">剩余调用次数</span>
              <span className="font-medium tabular-nums text-foreground">
                {perCallSub.remainingCalls ?? perCallSub.remaining} / {perCallSub.totalCalls} 次
              </span>
            </div>
            <Progress
              className="h-1.5 rounded-full bg-surface-hover/80"
              value={percentOf(
                perCallSub.remainingCalls ?? perCallSub.remaining,
                perCallSub.totalCalls,
              )}
              indicatorClassName="bg-[#0b7fff] dark:bg-[#4099ff] rounded-full"
            />
          </div>
        ) : (
          <p className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.noSubscription" })}
          </p>
        )}
      </div>

      {/* 3. 近 30 天用量趋势 */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui-sm font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.usageChartTitle" }, { days: USAGE_DAYS })}
          </span>
          <span className="text-ui-xs tabular-nums text-foreground-subtle">
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
          <div className="flex h-40 items-center justify-center text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <NimbusQuotaUsageChart usage={usage} />
        )}
      </div>

      {/* 网页端引用：用量明细/流水等完整数据引导去 Web 门户，APP 保持精简。 */}
      {portalUsageUrl ? (
        <div className="flex justify-end">
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

      {/* 充值弹窗：支付成功后在弹窗内部 toast + 刷新共享快照，余额卡随快照更新。 */}
      <NimbusRechargeDialog
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        creditsPerYuan={wallet.creditsPerYuan}
      />
    </div>
  );
}
