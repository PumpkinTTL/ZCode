/**
 * 侧边额度面板的两张数据卡（积分余额 + 套餐额度）：纯展示，数据由
 * NimbusQuotaSidePanel 喂入，自身不取数、不发请求。
 *
 * 视觉规范（DESIGN.md + design-md 技能六条硬规则）：
 * - 卡容器 = 低强调容器 `rounded-xl border-border/60 bg-surface p-4`
 *   （面板壳是 bg-popover，card/popover 同值无法分层；surface 是浮层内瓦片的正确 token）；
 * - 数字一律 UI 无衬线 + `tabular-nums` 裸格式（禁止 font-mono），单位语义放小字标签；
 * - 窗口分色沿用设置页「我的额度」同款：5 小时窗蓝 / 本周窗靛，低量转琥珀/玫红；
 * - 发丝线统一 `border-border/60`，间距走 4px 网格（p-4 / space-y-3 / pt-3）。
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
      className="space-y-3 rounded-xl border border-border/60 bg-surface p-4"
      data-quota-side-wallet=""
    >
      <div className="flex items-center gap-2 text-ui-sm">
        <span className="min-w-0 truncate font-semibold text-foreground">
          {intl.formatMessage({ id: "business.quota.available" })}
        </span>
        {wallet.lowBalance ? (
          <span className="inline-flex shrink-0 items-center rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-ui-xs font-medium leading-none text-amber-600 dark:text-amber-400">
            {intl.formatMessage({ id: "business.quota.lowBalanceBadge" })}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-ui-xl font-bold tabular-nums tracking-tight text-foreground">
          {formatCredits(wallet.available)}
        </span>
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.creditsUnit" })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-ui-xs">
        <div className="flex items-center justify-between gap-2 border-r border-border/60 pr-3">
          <span className="min-w-0 truncate text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.todaySpend" })}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-foreground">
            {formatCredits(wallet.todaySpend)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.monthSpend" })}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-foreground">
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

/** 窗口色调 → 正常态强调色（与设置页「我的额度」窗口分色同款）。 */
const WINDOW_TONE_CLASS = {
  blue: "text-blue-600 dark:text-blue-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
} as const;

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
  tone: keyof typeof WINDOW_TONE_CLASS;
}) {
  const percent = percentOf(remaining, limit);
  const isLow = percent <= 20;
  const isCritical = percent <= 10;

  return (
    <div className="space-y-2" data-quota-side-window-row="">
      <div className="flex items-center justify-between gap-2 text-ui-sm">
        <span className="shrink-0 font-semibold whitespace-nowrap text-foreground">{label}</span>
        <span
          className={cn(
            "shrink-0 font-medium tabular-nums",
            isCritical
              ? "text-rose-600 dark:text-rose-400"
              : isLow
                ? "text-amber-600 dark:text-amber-400"
                : WINDOW_TONE_CLASS[tone],
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
      <div className="flex items-center justify-between gap-2 text-ui-xs tabular-nums">
        <span className="shrink-0 whitespace-nowrap">
          <span className="font-medium text-foreground">{formatCredits(remaining)}</span>
          <span className="text-foreground-subtle">{" / "}{formatCredits(limit)}</span>
        </span>
        {resetText ? (
          <span className="min-w-0 truncate text-foreground-subtle">{resetText}</span>
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
      className="space-y-3 rounded-xl border border-border/60 bg-surface p-4"
      data-quota-side-plan=""
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-ui-sm">
          <span className="shrink-0 font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.subscriptions" })}
          </span>
          {planName ? (
            <span className="min-w-0 truncate text-ui-xs text-foreground-subtle">
              ({formatQuotaPlanName(planName)})
            </span>
          ) : null}
        </div>
        {resetCardCount > 0 ? (
          // 与设置页「我的额度」重置卡徽章同款（浅色鼠尾草绿 / 深色同系微透）。
          <button
            type="button"
            title={intl.formatMessage({ id: "business.quota.resetCardBadgeTitle" })}
            className="inline-flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-[#b8d5be] bg-[#eef5ef] px-1.5 text-ui-xs font-medium leading-none text-[#345e3d] transition-colors select-none hover:border-[#a8caa0] hover:bg-[#e4eee5] active:bg-[#d8e7da] dark:border-[#8ec69b]/25 dark:bg-[#8ec69b]/12 dark:text-[#8ec69b] dark:hover:border-[#8ec69b]/35 dark:hover:bg-[#8ec69b]/18"
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
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.noSubscription" })}
        </p>
      )}
    </section>
  );
}
