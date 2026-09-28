/**
 * Nimbus 账号弹窗（Polaris 自有业务）。
 *
 * 未登录：登录表单；已登录：账户 + 钱包 + 套餐额度。
 * 数据来自 `packages/services/src/business/quota/`（IProviderQuotaService）。
 *
 * 本目录（ui/src/business/）是**自有业务前端**，与上游组件隔离：
 * 删除本目录 + services 的 business/ 目录即为整体下线。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaStatusResult,
  QuotaSubscription,
} from "@zcode/services";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type Intl = ReturnType<typeof useZCodeIntl>["intl"];

/** 积分 → 元（汇率从 /user/me 实时读，禁止写死）。 */
function creditsToYuan(credits: number, creditsPerYuan: number): string {
  if (creditsPerYuan <= 0) return "—";
  return (credits / creditsPerYuan).toFixed(2);
}

function formatCredits(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function QuotaMetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1" data-quota-metric-row="">
      <span className="text-ui-base text-foreground-subtle">{label}</span>
      <span className="text-ui-base font-medium text-foreground" title={hint}>
        {value}
      </span>
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
  const window5hLeft =
    sub.limit5h !== null && sub.used5h !== null ? sub.limit5h - sub.used5h : null;
  const weeklyLeft =
    sub.limitWeekly !== null && sub.usedWeekly !== null
      ? sub.limitWeekly - sub.usedWeekly
      : null;

  return (
    <div className="rounded-lg border border-border p-3" data-quota-subscription-kind="credits">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-base font-medium text-foreground">{sub.planName}</span>
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.credits" })}
        </span>
      </div>
      <QuotaMetricRow
        label={intl.formatMessage({ id: "business.quota.remaining" })}
        value={formatCredits(sub.remaining)}
      />
      {weeklyLeft !== null ? (
        <QuotaMetricRow
          label={intl.formatMessage({ id: "business.quota.weeklyLeft" })}
          value={formatCredits(weeklyLeft)}
        />
      ) : null}
      {window5hLeft !== null ? (
        <QuotaMetricRow
          label={intl.formatMessage({ id: "business.quota.window5hLeft" })}
          value={formatCredits(window5hLeft)}
        />
      ) : null}
      <QuotaMetricRow
        label={intl.formatMessage({ id: "business.quota.remainingYuan" })}
        value={`¥${creditsToYuan(sub.remaining, creditsPerYuan)}`}
        hint={intl.formatMessage({ id: "business.quota.rateHint" })}
      />
    </div>
  );
}

function PerCallSubscriptionCard({
  sub,
  intl,
}: {
  sub: QuotaPerCallSubscription;
  intl: Intl;
}) {
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

function LoginBody({
  busy,
  error,
  onSubmit,
  intl,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
  intl: Intl;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="space-y-3"
      data-provider-quota-login=""
      onSubmit={(event) => {
        event.preventDefault();
        if (!username.trim() || !password) return;
        onSubmit(username.trim(), password);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="quota-username">
          {intl.formatMessage({ id: "business.quota.username" })}
        </Label>
        <Input
          id="quota-username"
          value={username}
          autoComplete="username"
          disabled={busy}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="quota-password">
          {intl.formatMessage({ id: "business.quota.password" })}
        </Label>
        <Input
          id="quota-password"
          type="password"
          value={password}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy || !username.trim() || !password}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {intl.formatMessage({ id: "business.quota.login" })}
      </Button>
    </form>
  );
}

function StatusBody({
  status,
  busy,
  onRefresh,
  onLogout,
  intl,
}: {
  status: Extract<QuotaStatusResult, { loggedIn: true }>;
  busy: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  intl: Intl;
}) {
  const wallet = status.account.wallet;
  const activeSubs = status.subscriptions;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-ui-base font-medium text-foreground">
          {status.account.username}
        </span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {intl.formatMessage({ id: "business.quota.refresh" })}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onLogout}>
            <LogOut className="size-4" />
            {intl.formatMessage({ id: "business.quota.logout" })}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-ui-sm font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.wallet" })}
        </div>
        <QuotaMetricRow
          label={intl.formatMessage({ id: "business.quota.available" })}
          value={formatCredits(wallet.available)}
        />
        <QuotaMetricRow
          label={intl.formatMessage({ id: "business.quota.availableYuan" })}
          value={`¥${creditsToYuan(wallet.available, wallet.creditsPerYuan)}`}
        />
        <QuotaMetricRow
          label={intl.formatMessage({ id: "business.quota.todaySpend" })}
          value={formatCredits(wallet.todaySpend)}
        />
        {wallet.lowBalance ? (
          <p className="mt-1 text-ui-sm text-warning">
            {intl.formatMessage({ id: "business.quota.lowBalance" })}
          </p>
        ) : null}
      </div>

      {activeSubs.length > 0 ? (
        <div className="space-y-2">
          <div className="text-ui-sm font-medium text-foreground-subtle">
            {intl.formatMessage({ id: "business.quota.subscriptions" })}
          </div>
          {activeSubs.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              sub={sub}
              creditsPerYuan={wallet.creditsPerYuan}
              intl={intl}
            />
          ))}
        </div>
      ) : (
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.noSubscription" })}
        </p>
      )}
    </div>
  );
}

export interface NimbusAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 登录态 + 额度的弹窗本体；ProviderQuotaSection 与升级弹窗 seam 都挂它。 */
export function NimbusAccountDialog({ open, onClose }: NimbusAccountDialogProps) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [status, setStatus] = useState<QuotaStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await providerQuotaService.getStatus());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [providerQuotaService]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await providerQuotaService.login({ username, password }));
      } catch (loginError) {
        setError(loginError instanceof Error ? loginError.message : String(loginError));
      } finally {
        setBusy(false);
      }
    },
    [providerQuotaService],
  );

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await providerQuotaService.logout();
      setStatus({ loggedIn: false });
    } finally {
      setBusy(false);
    }
  }, [providerQuotaService]);

  const loggedIn = status?.loggedIn === true;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md" data-business="nimbus-account">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "business.quota.title" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "business.quota.description" })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-24 items-center justify-center text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setError(null);
                void refresh();
              }}
            >
              {intl.formatMessage({ id: "business.quota.retry" })}
            </Button>
          </div>
        ) : loggedIn && status?.loggedIn ? (
          <StatusBody
            status={status}
            busy={busy}
            onRefresh={() => void refresh()}
            onLogout={() => void handleLogout()}
            intl={intl}
          />
        ) : (
          <LoginBody
            busy={busy}
            error={error}
            onSubmit={(username, password) => void handleLogin(username, password)}
            intl={intl}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
