/**
 * 侧边额度面板的两张数据卡（积分余额 + 套餐额度）：纯展示，数据由
 * NimbusQuotaSidePanel 喂入，自身不取数、不发请求。
 *
 * 单独成文件是为了与面板外壳（Dialog 定位 / 登录引导 / 底部操作）分离，两张卡
 * 目前只有侧边面板一个宿主，不做多余抽象——props 直接是服务层类型。
 *
 * 口径与「我的额度」设置页同源（QuotaStatusResult）：
 * - 积分余额大字 = 钱包可用余额（formatCredits 裸数字，不加千分位）；
 * - 窗口行按剩余量直读（limit − used），百分比走 percentOf，进度条低量变琥珀/玫红；
 * - 空窗（limit 为 null/0）整行不渲染，绝不猜字段（文档口径：看不到的字段不要猜）。
 */
import type {
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaStatusResult,
  QuotaWalletInfo,
} from "@zcode/services";
import { Gift } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Progress } from "@/components/ui/progress.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatCredits, formatQuotaPlanName, percentOf } from "./quotaFormat.js";

type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;

// ------------------------------------------------------------
// 积分余额卡
// ------------------------------------------------------------

export function NimbusQuotaWalletCard({ wallet }: { wallet: QuotaWalletInfo }) {
  const { intl } = useZCodeIntl();

  return (
    <section
      className="space-y-1.5 rounded-xl border border-border/50 bg-muted/30 p-2.5"
      data-quota-side-wallet=""
    >
      <div className="flex items-center gap-1.5 text-ui-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {intl.formatMessage({ id: "business.quota.available" })}
        </span>
        {wallet.lowBalance ? (
          <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-ui-xs font-medium leading-none text-amber-600 dark:text-amber-400">
            {intl.formatMessage({ id: "business.quota.lowBalanceBadge" })}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-1">
        <span className="font-mono text-ui-lg font-bold tabular-nums text-foreground">
          {formatCredits(wallet.available)}
        </span>
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.creditsUnit" })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/40 pt-1.5 text-ui-xs">
        <div className="flex items-center justify-between gap-2 border-r border-border/60 pr-2.5">
          <span className="min-w-0 truncate text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.todaySpend" })}
          </span>
          <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">
            {formatCredits(wallet.todaySpend)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 pl-0.5">
          <span className="min-w-0 truncate text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.monthSpend" })}
          </span>
          <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">
            {formatCredits(wallet.monthSpend)}
          </span>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// 套餐额度卡
// ------------------------------------------------------------

/** 一道窗口闸的展示行：名称 + 剩余百分比 / 进度条 / 剩余·上限 + 重置时刻。 */
function WindowRow({
  label,
  remaining,
  limit,
  resetText,
  tone,
}: {
  label: string;
  remaining: number;
  limit: number;
  /** 重置时刻文案（null = 不展示，如周窗未锚定）。 */
  resetText: string | null;
  tone: "blue" | "indigo";
}) {
  const percent = percentOf(remaining, limit);
  const isLow = percent <= 20;
  const isCritical = percent <= 10;

  return (
    <div className="space-y-1.5" data-quota-side-window-row="">
      <div className="flex items-center justify-between gap-2 text-ui-xs">
        <span className="shrink-0 font-medium whitespace-nowrap text-foreground">{label}</span>
        <span
          className={cn(
            "shrink-0 font-mono font-medium tabular-nums",
            isCritical
              ? "text-rose-600 dark:text-rose-400"
              : isLow
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground",
          )}
        >
          {Math.round(percent)}%
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={label}
        className="h-2.5 rounded-full bg-surface-hover/80"
        indicatorClassName={cn(
          "rounded-full",
          isCritical
            ? "bg-rose-500"
            : isLow
              ? "bg-amber-500"
              : tone === "indigo"
                ? "bg-indigo-600 dark:bg-indigo-500"
                : "bg-blue-600 dark:bg-blue-500",
        )}
      />
      <div className="flex items-center justify-between gap-2 font-mono text-ui-xs tabular-nums">
        <span className="shrink-0 whitespace-nowrap text-foreground-subtle">
          <span className="font-medium text-foreground">{formatCredits(remaining)}</span>
          {" / "}
          {formatCredits(limit)}
        </span>
        {resetText ? (
          <span className="min-w-0 truncate text-ui-xs text-foreground-subtle/80">
            {resetText}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function NimbusQuotaPlanCard({
  status,
  resetCardCount,
  onOpenResetCards,
}: {
  status: LoggedInStatus;
  /** 「我的可用重置卡」数量（0 = 不渲染礼物徽章）。 */
  resetCardCount: number;
  /** 礼物徽章点击：打开「可重置额度」弹窗（面板外壳持有弹窗状态）。 */
  onOpenResetCards: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const creditsSub: QuotaCreditsSubscription | undefined = status.subscriptions.find(
    (sub) => sub.kind === "credits",
  );
  const perCallSub: QuotaPerCallSubscription | undefined = status.subscriptions.find(
    (sub) => sub.kind === "per_call",
  );
  const planName = creditsSub?.planName ?? perCallSub?.planName ?? "";

  const formatResetMoment = (ms: number, withDate: boolean): string =>
    new Intl.DateTimeFormat(locale, {
      ...(withDate ? { month: "numeric", day: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);

  /** 重置时刻文案：空窗/未锚定不给（滚动更新用通用文案兜底）。 */
  const resetAtText = (ms: number, withDate: boolean): string | null =>
    ms > 0
      ? intl.formatMessage(
          { id: "business.quota.windowResetsAt" },
          { time: formatResetMoment(ms, withDate) },
        )
      : null;

  const remaining5h =
    creditsSub && creditsSub.limit5h !== null && creditsSub.limit5h > 0
      ? Math.max(0, creditsSub.limit5h - (creditsSub.used5h ?? 0))
      : null;
  const remainingWeekly =
    creditsSub && creditsSub.limitWeekly !== null && creditsSub.limitWeekly > 0
      ? Math.max(0, creditsSub.limitWeekly - (creditsSub.usedWeekly ?? 0))
      : null;

  const perCallRemaining = perCallSub?.remainingCalls ?? perCallSub?.remaining ?? 0;
  const perCallTotal = perCallSub?.totalCalls ?? 0;
  const perCallExpiry =
    perCallSub && perCallSub.expiresAt === 0
      ? intl.formatMessage({ id: "business.quota.notActivated" })
      : perCallSub && perCallSub.expiresAt > 0
        ? intl.formatMessage(
            { id: "business.quota.validUntil" },
            { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(perCallSub.expiresAt) },
          )
        : null;

  const hasCreditsWindows = remaining5h !== null || remainingWeekly !== null;

  return (
    <section
      className="space-y-3 rounded-xl border border-border/50 bg-muted/30 p-3"
      data-quota-side-plan=""
    >
      <div className="flex items-center justify-between gap-2 text-ui-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.subscriptions" })}
          </span>
          {planName ? (
            <span className="min-w-0 truncate text-foreground-subtle">
              ({formatQuotaPlanName(planName)})
            </span>
          ) : null}
        </div>
        {resetCardCount > 0 ? (
          <button
            type="button"
            title={intl.formatMessage({ id: "business.quota.resetCardBadgeTitle" })}
            className="inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 text-ui-xs font-medium leading-none text-emerald-700 select-none transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/15 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:border-emerald-500/40"
            onClick={onOpenResetCards}
          >
            <Gift aria-hidden="true" className="size-3 shrink-0" />
            <span className="leading-none">
              {intl.formatMessage(
                { id: "business.quota.resetCardBadge" },
                { count: resetCardCount },
              )}
            </span>
          </button>
        ) : null}
      </div>

      {creditsSub && hasCreditsWindows ? (
        <div className="space-y-3">
          {remaining5h !== null && creditsSub.limit5h !== null ? (
            <WindowRow
              tone="blue"
              label={intl.formatMessage({ id: "business.quota.window5hTitle" })}
              remaining={remaining5h}
              limit={creditsSub.limit5h}
              resetText={
                resetAtText(creditsSub.next5hRefreshAt, false) ??
                intl.formatMessage({ id: "business.quota.rollingUpdate" })
              }
            />
          ) : null}
          {remainingWeekly !== null && creditsSub.limitWeekly !== null ? (
            <WindowRow
              tone="indigo"
              label={intl.formatMessage({ id: "business.quota.windowWeeklyTitle" })}
              remaining={remainingWeekly}
              limit={creditsSub.limitWeekly}
              resetText={resetAtText(creditsSub.nextWeekResetAt, true)}
            />
          ) : null}
        </div>
      ) : perCallSub && perCallTotal > 0 ? (
        <WindowRow
          tone="blue"
          label={intl.formatMessage({ id: "business.quota.remainingCalls" })}
          remaining={perCallRemaining}
          limit={perCallTotal}
          resetText={perCallExpiry}
        />
      ) : (
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.noSubscription" })}
        </p>
      )}
    </section>
  );
}
