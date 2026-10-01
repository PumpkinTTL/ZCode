/**
 * 「我的额度」已登录面板：账户头 + 剩余额度进度 + 指标卡 + 套餐进度 + 近 30 天用量图表。
 *
 * 之前这里只有几行文字（账号 / 钱包 / 套餐），要点开弹窗才看得到，而且没有任何图形。
 * 面板本体是数据驱动的只读视图，登录/登出仍由 NimbusAccountDialog 负责。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaStatusResult,
  QuotaSubscription,
  QuotaUsageDay,
} from "@zcode/services";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { NimbusQuotaUsageChart, summarizeQuotaUsage } from "./NimbusQuotaUsageChart.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Progress } from "@/components/ui/progress.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type Intl = ReturnType<typeof useZCodeIntl>["intl"];
type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;
const USAGE_DAYS = 30;

/** 积分 → 元（汇率从 /user/me 实时读，禁止写死）。 */
export function creditsToYuan(credits: number, creditsPerYuan: number): string {
  if (creditsPerYuan <= 0) return "—";
  return (credits / creditsPerYuan).toFixed(2);
}

export function formatCredits(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function percentOf(part: number, total: number | null | undefined): number {
  if (total === null || total === undefined || total <= 0) return 0;
  return Math.min(Math.max((part / total) * 100, 0), 100);
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3" data-quota-metric-card="">
      <div className="text-ui-sm text-foreground-subtle">{label}</div>
      <div className="mt-1 text-ui-lg font-medium tabular-nums text-foreground" title={hint}>
        {value}
      </div>
    </div>
  );
}

function QuotaMetricRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" data-quota-metric-row="">
      <span className="text-ui-base text-foreground-subtle">{label}</span>
      <span className="text-ui-base font-medium tabular-nums text-foreground" title={hint}>
        {value}
      </span>
    </div>
  );
}

/** 带进度条的用量行：右侧显示 used/total，条本身给出肉眼可比的占比。 */
function QuotaWindowRow({
  label,
  used,
  limit,
}: {
  label: string;
  used: number | null;
  limit: number | null;
}) {
  if (used === null || limit === null || limit <= 0) return null;
  const percent = percentOf(used, limit);
  return (
    <div className="space-y-1 py-1.5" data-quota-window-row="">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui-base text-foreground-subtle">{label}</span>
        <span className="text-ui-base font-medium tabular-nums text-foreground">
          {formatCredits(used)} / {formatCredits(limit)}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}

function CreditsSubscriptionCard({
  sub,
  creditsPerYuan,
  intl,
}: {
  sub: QuotaCreditsSubscription;
  creditsPerYuan: number;
  intl: Intl;
}) {
  return (
    <div className="rounded-lg border border-border p-3" data-quota-subscription-kind="credits">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-base font-medium text-foreground">{sub.planName}</span>
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.credits" })}
        </span>
      </div>
      <QuotaWindowRow
        label={intl.formatMessage({ id: "business.quota.remaining" })}
        used={sub.remaining}
        limit={sub.creditsTotal}
      />
      <QuotaWindowRow
        label={intl.formatMessage({ id: "business.quota.window5h" })}
        used={sub.used5h}
        limit={sub.limit5h}
      />
      <QuotaWindowRow
        label={intl.formatMessage({ id: "business.quota.windowWeekly" })}
        used={sub.usedWeekly}
        limit={sub.limitWeekly}
      />
      <QuotaMetricRow
        label={intl.formatMessage({ id: "business.quota.remainingYuan" })}
        value={`¥${creditsToYuan(sub.remaining, creditsPerYuan)}`}
        hint={intl.formatMessage({ id: "business.quota.rateHint" })}
      />
    </div>
  );
}

function PerCallSubscriptionCard({ sub, intl }: { sub: QuotaPerCallSubscription; intl: Intl }) {
  // 未激活（expires_at=0）：有效期从首次成功调用起算，不烧时间。
  const notActivated = sub.expiresAt === 0;
  return (
    <div className="rounded-lg border border-border p-3" data-quota-subscription-kind="per_call">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-base font-medium text-foreground">{sub.planName}</span>
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.perCall" })}
        </span>
      </div>
      <QuotaWindowRow
        label={intl.formatMessage({ id: "business.quota.remainingCalls" })}
        used={sub.callsUsed}
        limit={sub.totalCalls}
      />
      <QuotaMetricRow
        label={intl.formatMessage({ id: "business.quota.remainingCalls" })}
        value={`${sub.remainingCalls ?? sub.remaining} / ${sub.totalCalls}`}
      />
      <QuotaMetricRow
        label={intl.formatMessage({ id: "business.quota.validity" })}
        value={
          notActivated
            ? intl.formatMessage({ id: "business.quota.notActivated" })
            : intl.formatMessage({ id: "business.quota.hoursLeft" }, { hours: sub.hoursLeft })
        }
      />
    </div>
  );
}

function SubscriptionCard({
  sub,
  creditsPerYuan,
  intl,
}: {
  sub: QuotaSubscription;
  creditsPerYuan: number;
  intl: Intl;
}) {
  return sub.kind === "per_call" ? (
    <PerCallSubscriptionCard sub={sub} intl={intl} />
  ) : (
    <CreditsSubscriptionCard sub={sub} creditsPerYuan={creditsPerYuan} intl={intl} />
  );
}

/** 剩余额度主卡：把"还能用多少"做成整块进度，而不是一行小字。 */
function QuotaHeroCard({ status, intl }: { status: LoggedInStatus; intl: Intl }) {
  const wallet = status.account.wallet;
  const quota = status.quota;
  // 钱包视图没有"总量"，用账面余额当分母；余额为 0 时不给条，只给数字。
  const total = quota.total ?? (wallet.balance > 0 ? wallet.balance : null);
  const percent = percentOf(quota.left, total);
  const unit =
    quota.kind === "per_call"
      ? intl.formatMessage({ id: "business.quota.callsUnit" })
      : intl.formatMessage({ id: "business.quota.credits" });

  return (
    <div className="rounded-xl border border-border p-4" data-quota-hero="">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.remaining" })}
        </span>
        <span className="text-ui-base font-medium tabular-nums text-foreground">
          {formatCredits(quota.left)}
          {total !== null ? ` / ${formatCredits(total)}` : ""}
          {` · ${unit}`}
        </span>
      </div>
      {total !== null ? (
        <Progress
          className="mt-3 h-2"
          value={percent}
          indicatorClassName={wallet.lowBalance ? "bg-warning" : undefined}
        />
      ) : null}
      <div className="mt-3 flex items-center justify-between text-ui-sm text-foreground-subtle">
        <span>
          {intl.formatMessage(
            { id: "business.quota.perYuan" },
            { credits: formatCredits(wallet.creditsPerYuan) },
          )}
        </span>
        {quota.notActivated ? (
          <span>{intl.formatMessage({ id: "business.quota.notActivated" })}</span>
        ) : null}
      </div>
      {wallet.lowBalance ? (
        <p className="mt-2 text-ui-sm text-warning">
          {intl.formatMessage({ id: "business.quota.lowBalance" })}
        </p>
      ) : null}
    </div>
  );
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
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [usage, setUsage] = useState<readonly QuotaUsageDay[] | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    setUsageError(null);
    try {
      setUsage(await providerQuotaService.getUsageDaily(USAGE_DAYS));
    } catch (error) {
      // 用量是补充信息：拿不到不影响额度与套餐的展示，只降级成一行说明。
      setUsageError(error instanceof Error ? error.message : String(error));
      setUsage([]);
    }
  }, [providerQuotaService]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const summary = useMemo(() => summarizeQuotaUsage(usage ?? []), [usage]);
  const wallet = status.account.wallet;
  const averageCacheHitRate =
    summary.averageCacheHitRate === null ? "—" : `${summary.averageCacheHitRate.toFixed(1)}%`;

  return (
    <div className="space-y-4" data-quota-overview="">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-ui-base font-medium text-foreground">
            {status.account.username}
          </div>
          {status.account.emailMasked ? (
            <div className="truncate text-ui-sm text-foreground-subtle">
              {status.account.emailMasked}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              onRefresh();
              void loadUsage();
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {intl.formatMessage({ id: "business.quota.refresh" })}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onLogout}>
            <LogOut className="size-4" />
            {intl.formatMessage({ id: "business.quota.logout" })}
          </Button>
        </div>
      </div>

      <QuotaHeroCard status={status} intl={intl} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label={intl.formatMessage({ id: "business.quota.available" })}
          value={`¥${creditsToYuan(wallet.available, wallet.creditsPerYuan)}`}
          hint={intl.formatMessage({ id: "business.quota.rateHint" })}
        />
        <MetricCard
          label={intl.formatMessage({ id: "business.quota.todaySpend" })}
          value={formatCredits(wallet.todaySpend)}
        />
        <MetricCard
          label={intl.formatMessage({ id: "business.quota.monthSpend" })}
          value={formatCredits(wallet.monthSpend)}
        />
        <MetricCard
          label={intl.formatMessage({ id: "business.quota.avgCacheHitRate" })}
          value={averageCacheHitRate}
        />
      </div>

      <div className="space-y-2">
        <div className="text-ui-sm font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.subscriptions" })}
        </div>
        {status.subscriptions.length > 0 ? (
          status.subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              creditsPerYuan={wallet.creditsPerYuan}
              intl={intl}
            />
          ))
        ) : (
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.noSubscription" })}
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-xl bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "business.quota.usageChartTitle" }, { days: USAGE_DAYS })}
          </span>
          <span className="text-ui-sm tabular-nums text-foreground-subtle">
            {intl.formatMessage(
              { id: "business.quota.usageTotal" },
              { value: formatCredits(summary.totalCharged) },
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
    </div>
  );
}
