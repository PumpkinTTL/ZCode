/* eslint-disable max-lines -- 同一额度摘要的三种形态（无套餐/紧凑弹窗/设置页常规）共享数据推导，
   拆文件只会把一次推导切成跨文件 props 传递；先集中维护形态边界。 */
/**
 * Nimbus 额度摘要块：模型设置供应商详情（官方套餐卡位）与上下文容量弹窗共用的紧凑视图。
 *
 * 视觉语言对齐官方计划面板：标题行（左套餐名 + 右等宽剩余/总量）、一条主进度条（粗）、
 * 用量窗口双列迷你卡（标签 + 百分比 + 细条 + 已用/上限）、border-t 附注行；全程单色强调。
 *
 * 与「我的额度」面板同源（useNimbusAccountState 单一数据源），只做只读投影：
 *   - 有周期套餐：套餐名 + 剩余/总量主条 + 5 小时窗/周窗两张迷你卡；
 *   - 有按次套餐：套餐名 + 剩余次数主条 + 有效期附注；
 *   - 未登录：不渲染（是否给登录引导由调用方决定），额度查询失败也不影响面板自身。
 */
import { useState } from "react";
import type {
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaStatusResult,
} from "@zcode/services";
import { ChevronRight, Gift } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatCredits, formatQuotaPlanName, percentOf } from "./quotaFormat.js";
import { QuotaMeterCell, QuotaMeterGrid } from "./quotaWindowCell.js";
import { useNimbusAccountState } from "./nimbusAccountState.js";
import { NimbusResetCardsDialog } from "./NimbusResetCardsDialog.js";

type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;

/**
 * 健壮解析真实到期时间：
 * 后端 raw.expires_at 在部分环境下返回的是相对时长，若转换为毫秒后落在 2020 年前（如 1970 年），
 * 则利用 hoursLeft 结合当前时间推算真实绝对到期时间戳。
 */
function resolveEffectiveExpiresAt(expiresAt: number, hoursLeft: number): number {
  if (expiresAt > 1577836800000) {
    return expiresAt;
  }
  if (hoursLeft > 0) {
    return Date.now() + hoursLeft * 3600 * 1000;
  }
  return 0;
}



/** 附注行（有效期 / 管理入口）：与官方面板同款 border-t 分隔。 */
function SummaryFooter({
  note,
  onManage,
  manageLabel,
}: {
  note: string | null;
  onManage?: () => void;
  manageLabel?: string;
}) {
  if (!note && !onManage) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-ui-sm">
      <span className="min-w-0 truncate text-foreground-subtle">{note}</span>
      {onManage ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground-subtle transition-colors hover:text-foreground cursor-pointer"
          onClick={onManage}
        >
          {manageLabel}
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function NimbusQuotaSummary({
  status,
  compact = false,
  onManage,
  resetCardCount = 0,
}: {
  /** 由调用方传入已取到的登录态；未登录传 null。 */
  status: LoggedInStatus | null;
  compact?: boolean;
  onManage?: () => void;
  /** 我的可用重置卡数量（0 = 不渲染礼物徽章）。 */
  resetCardCount?: number;
}) {
  const { intl, locale } = useZCodeIntl();
  // 礼物徽章 →「可重置额度」弹窗（真实兑换入口）。compact 才有徽章；设置页大卡走「更多」。
  const [resetCardsOpen, setResetCardsOpen] = useState(false);

  if (!status) return null;

  const creditsSub: QuotaCreditsSubscription | undefined = status.subscriptions.find(
    (sub) => sub.kind === "credits",
  );
  const perCallSub: QuotaPerCallSubscription | undefined = status.subscriptions.find(
    (sub) => sub.kind === "per_call",
  );
  const manageLabel = intl.formatMessage({ id: "business.quota.manage" });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const monthDayFmt = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });

  const renderMoreButton = () =>
    onManage ? (
      <button
        type="button"
        aria-label="更多"
        className="inline-flex items-center gap-0.5 text-ui-caption text-foreground-subtle transition-colors hover:text-foreground cursor-pointer select-none"
        onClick={onManage}
      >
        <span>更多</span>
        <ChevronRight className="size-3.5" />
      </button>
    ) : null;

  /** 重置卡徽章：官方样式「获得N次重置额度」，点击打开「可重置额度」弹窗（真实兑换）。 */
  const renderResetCardBadge = () =>
    resetCardCount > 0 ? (
      <button
        type="button"
        title={intl.formatMessage({ id: "business.quota.resetCardBadgeTitle" })}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 text-ui-sm font-medium leading-none text-emerald-700 dark:text-emerald-300 cursor-pointer"
        onClick={() => setResetCardsOpen(true)}
      >
        <Gift aria-hidden="true" className="size-3" />
        <span>
          {intl.formatMessage(
            { id: "business.quota.resetCardBadge" },
            { count: resetCardCount },
          )}
        </span>
      </button>
    ) : null;

  // 没有任何套餐：回退钱包口径
  if (!creditsSub && !perCallSub) {
    if (compact) {
      return (
        <div className="space-y-2.5" data-nimbus-quota-summary="">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "business.quota.remaining" })}
            </span>
            {renderMoreButton()}
          </div>
          <QuotaMeterGrid columns={3}>
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.available" })}
              value={formatCredits(status.quota.left)}
              subValue={intl.formatMessage({ id: "business.quota.creditsUnit" })}
              percent={null}
              color="var(--color-usage-chart-1, #0b7fff)"
            />
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.todaySpend" })}
              value={formatCredits(status.account.wallet.todaySpend)}
              percent={null}
              color="var(--color-usage-chart-3, #9e77ed)"
            />
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.monthSpend" })}
              value={formatCredits(status.account.wallet.monthSpend)}
              percent={null}
              color="var(--color-usage-chart-5, #e07b00)"
            />
          </QuotaMeterGrid>
          <SummaryFooter
            note={intl.formatMessage({ id: "business.quota.noSubscription" })}
            onManage={onManage}
            manageLabel={manageLabel}
          />
        </div>
      );
    }

    return (
      <div className="space-y-2.5" data-nimbus-quota-summary="">
        <div className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 truncate text-ui-base font-medium text-foreground">Nimbus</span>
          <span className="ml-auto shrink-0 text-right font-mono text-ui-sm tabular-nums text-foreground-subtle">
            {formatCredits(status.quota.left)} ·{" "}
            {intl.formatMessage({ id: "business.quota.creditsUnit" })}
          </span>
          {renderMoreButton()}
        </div>
        <SummaryFooter
          note={intl.formatMessage({ id: "business.quota.noSubscription" })}
          onManage={onManage}
          manageLabel={manageLabel}
        />
      </div>
    );
  }

  // 主条数值：周期套餐给「剩余/总量」，按次套餐给「剩余次数/总次数」。
  const heroUsed = creditsSub
    ? creditsSub.remaining
    : (perCallSub?.remainingCalls ?? perCallSub?.remaining ?? 0);
  const heroTotal = creditsSub ? creditsSub.creditsTotal : (perCallSub?.totalCalls ?? 0);
  const heroUnit = creditsSub ? null : intl.formatMessage({ id: "business.quota.callsUnit" });
  const heroPercent = percentOf(heroUsed, heroTotal);
  const planName = creditsSub?.planName ?? perCallSub?.planName ?? "";
  const rawExpiresAt = creditsSub?.expiresAt ?? perCallSub?.expiresAt ?? 0;
  const hoursLeft = creditsSub?.hoursLeft ?? perCallSub?.hoursLeft ?? 0;
  const effectiveExpiresAt = resolveEffectiveExpiresAt(rawExpiresAt, hoursLeft);

  // 统一提炼剩余量与重置倒计时计算（扣减逻辑，越用越少）
  const remaining5h =
    creditsSub?.limit5h !== null && creditsSub?.limit5h !== undefined && creditsSub.limit5h > 0
      ? Math.max(0, creditsSub.limit5h - (creditsSub.used5h ?? 0))
      : 0;
  const remaining5hPercent =
    creditsSub?.limit5h !== null && creditsSub?.limit5h !== undefined && creditsSub.limit5h > 0
      ? percentOf(remaining5h, creditsSub.limit5h)
      : 0;

  const remainingWeekly =
    creditsSub?.limitWeekly !== null &&
    creditsSub?.limitWeekly !== undefined &&
    creditsSub.limitWeekly > 0
      ? Math.max(0, creditsSub.limitWeekly - (creditsSub.usedWeekly ?? 0))
      : 0;
  const remainingWeeklyPercent =
    creditsSub?.limitWeekly !== null &&
    creditsSub?.limitWeekly !== undefined &&
    creditsSub.limitWeekly > 0
      ? percentOf(remainingWeekly, creditsSub.limitWeekly)
      : 0;

  // 同上：裸数字，无千分位。
  const formatSubCredits = (val: number) => String(Math.round(val));
  const creditsUnitLabel = intl.formatMessage({ id: "business.quota.creditsUnit" });

  // 重置时刻副文本（官方形态：裸时间/裸日期，如「01:03」「10/12」——
  // 带「后重置」措辞会在三列窄卡里溢出出省略号）。空窗/未锚定不给副文本。
  // 5 小时窗的重置显示：只显示重置时刻 HH:mm（跨天也不带日期——
  // 滑动窗必然在 5 小时内滚出，日期没有信息量）。
  const reset5hSub = (() => {
    if (!creditsSub || !(creditsSub.next5hRefreshAt > 0)) return null;
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(creditsSub.next5hRefreshAt),
    );
  })();
  const weeklyResetDate =
    creditsSub && creditsSub.nextWeekResetAt > 0
      ? monthDayFmt.format(creditsSub.nextWeekResetAt)
      : null;

  // 紧凑弹窗视图（输入框浮层等）
  if (compact) {
    return (
      <div className="space-y-2.5" data-nimbus-quota-summary="">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-ui-base font-semibold text-foreground">
              {intl.formatMessage({ id: "business.quota.remaining" })}
            </span>
            {renderResetCardBadge()}
          </div>
          {renderMoreButton()}
        </div>

        {creditsSub ? (
          <QuotaMeterGrid columns={3}>
            {creditsSub.limit5h !== null && creditsSub.limit5h > 0 ? (
              <QuotaMeterCell
                label={intl.formatMessage({ id: "business.quota.window5hShort" })}
                value={`${Math.round(remaining5hPercent)}%`}
                subValue={reset5hSub}
                percent={remaining5hPercent}
                color="var(--color-usage-chart-1, #0b7fff)"
              />
            ) : null}
            {creditsSub.limitWeekly !== null && creditsSub.limitWeekly > 0 ? (
              <QuotaMeterCell
                label={intl.formatMessage({ id: "business.quota.windowWeeklyShort" })}
                value={`${Math.round(remainingWeeklyPercent)}%`}
                subValue={weeklyResetDate}
                percent={remainingWeeklyPercent}
                color="var(--color-usage-chart-3, #9e77ed)"
              />
            ) : null}
            {/* 基本额度 = 钱包积分余额（无总量概念，不给百分比与进度条） */}
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.baseQuota" })}
              value={formatSubCredits(status.account.wallet.available)}
              subValue={creditsUnitLabel}
              percent={null}
              color="var(--color-usage-chart-5, #e07b00)"
            />
          </QuotaMeterGrid>
        ) : perCallSub ? (
          <QuotaMeterGrid columns={3}>
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.remainingCalls" })}
              value={`${heroUsed} ${heroUnit ?? ""}`}
              subValue={`/ ${heroTotal}`}
              percent={heroPercent}
              color="var(--color-usage-chart-1, #0b7fff)"
            />
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.validity" })}
              value={
                perCallSub.expiresAt === 0
                  ? intl.formatMessage({ id: "business.quota.notActivated" })
                  : effectiveExpiresAt > 0
                    ? monthDayFmt.format(effectiveExpiresAt)
                    : `${perCallSub.hoursLeft}h`
              }
              percent={heroPercent}
              color="var(--color-usage-chart-3, #9e77ed)"
            />
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.available" })}
              value={formatSubCredits(status.account.wallet.available)}
              subValue={creditsUnitLabel}
              percent={null}
              color="var(--color-usage-chart-5, #e07b00)"
            />
          </QuotaMeterGrid>
        ) : null}

        <NimbusResetCardsDialog
          open={resetCardsOpen}
          onClose={() => setResetCardsOpen(false)}
          status={status}
          onManage={onManage}
        />
      </div>
    );
  }

  // 常规视图（设置页供应商详情卡：对齐官方三列仪表优雅卡片）
  return (
    <div className="space-y-3" data-nimbus-quota-summary="">
      {/* 标题行：左侧「剩余额度」+ 套餐名，右侧「更多 >」 */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-base font-semibold text-foreground">
            {intl.formatMessage({ id: "business.quota.remaining" })}
          </span>
          {planName ? (
            <span className="text-ui-xs text-foreground-subtle">
              ({formatQuotaPlanName(planName)})
            </span>
          ) : null}
          {renderResetCardBadge()}
        </div>
        {renderMoreButton()}
      </div>

      {/* 核心三列仪表 */}
      {creditsSub ? (
        <QuotaMeterGrid columns={3}>
          {creditsSub.limit5h !== null && creditsSub.limit5h > 0 ? (
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.window5hShort" })}
              value={`${Math.round(remaining5hPercent)}%`}
              subValue={reset5hSub}
              percent={remaining5hPercent}
              color="var(--color-usage-chart-1, #0b7fff)"
            />
          ) : null}
          {creditsSub.limitWeekly !== null && creditsSub.limitWeekly > 0 ? (
            <QuotaMeterCell
              label={intl.formatMessage({ id: "business.quota.windowWeeklyShort" })}
              value={`${Math.round(remainingWeeklyPercent)}%`}
              subValue={weeklyResetDate}
              percent={remainingWeeklyPercent}
              color="var(--color-usage-chart-3, #9e77ed)"
            />
          ) : null}
          <QuotaMeterCell
            label={intl.formatMessage({ id: "business.quota.baseQuota" })}
            value={`${Math.round(heroPercent)}%`}
            subValue={formatSubCredits(heroUsed)}
            percent={heroPercent}
            color="var(--color-usage-chart-5, #e07b00)"
          />
        </QuotaMeterGrid>
      ) : perCallSub ? (
        <QuotaMeterGrid columns={3}>
          <QuotaMeterCell
            label={intl.formatMessage({ id: "business.quota.remainingCalls" })}
            value={`${heroUsed} ${heroUnit ?? ""}`}
            subValue={`/ ${heroTotal}`}
            percent={heroPercent}
            color="var(--color-usage-chart-1, #0b7fff)"
          />
          <QuotaMeterCell
            label={intl.formatMessage({ id: "business.quota.validity" })}
            value={
              perCallSub.expiresAt === 0
                ? intl.formatMessage({ id: "business.quota.notActivated" })
                : effectiveExpiresAt > 0
                  ? monthDayFmt.format(effectiveExpiresAt)
                  : `${perCallSub.hoursLeft}h`
            }
            percent={heroPercent}
            color="var(--color-usage-chart-3, #9e77ed)"
          />
          <QuotaMeterCell
            label={intl.formatMessage({ id: "business.quota.available" })}
            value={formatSubCredits(status.account.wallet.available)}
            subValue={creditsUnitLabel}
            percent={null}
            color="var(--color-usage-chart-5, #e07b00)"
          />
        </QuotaMeterGrid>
      ) : null}

      <SummaryFooter
        note={
          effectiveExpiresAt > 0
            ? intl.formatMessage(
                { id: "business.quota.validUntil" },
                { date: dateFmt.format(effectiveExpiresAt) },
              )
            : null
        }
      />

      <NimbusResetCardsDialog
        open={resetCardsOpen}
        onClose={() => setResetCardsOpen(false)}
        status={status}
        onManage={onManage}
      />
    </div>
  );
}

/**
 * 宿主便捷封装：自己订阅共享状态，未登录返回 null。
 * 模型设置详情卡与上下文弹窗直接用它，无需各自接 useNimbusAccountState。
 */
export function NimbusQuotaSummaryAuto(props: { compact?: boolean; onManage?: () => void }) {
  const account = useNimbusAccountState();
  const status = account.status !== null && account.status.loggedIn ? account.status : null;
  return (
    <NimbusQuotaSummary
      status={status}
      compact={props.compact}
      onManage={props.onManage}
      resetCardCount={account.resetCardCount}
    />
  );
}

