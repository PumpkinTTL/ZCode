/**
 * Nimbus 额度面板（Polaris 自有业务）。
 *
 * 登录 + 账户/钱包/套餐额度一屏；数据来自
 * `packages/services/src/business/quota/`（IProviderQuotaService）。
 * 本目录（ui/src/business/）是**自有业务前端**，与上游组件隔离：
 * 删除本目录 + services 的 business/ 目录即为整体下线。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QuotaCreditsSubscription,
  QuotaPerCallSubscription,
  QuotaStatusResult,
  QuotaSubscription,
} from "@zcode/services";
import { Loader2, LogOut, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { useServices } from "@/hooks/useServices.js";
import { provisionNimbusProvider } from "./provisionNimbusProvider.js";
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

function LoginCard({
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

export function ProviderQuotaSection() {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService } = useServices();
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
    void refresh();
  }, [refresh]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await providerQuotaService.login({ username, password });

        // 登录成功后自动开通：sk- 密钥 → 建/更新 Nimbus 供应商 → 置顶。
        // 供应商列表是全局状态，这里完成后模型菜单全应用立即可见。
        if (result.loggedIn) {
          try {
            await provisionNimbusProvider({
              quota: providerQuotaService,
              providerSettings: providerSettingsService,
            });
          } catch (provisionError) {
            // 开通失败不回滚登录：额度面板照常显示，供应商可稍后重试或手动添加。
            const message =
              provisionError instanceof Error ? provisionError.message : String(provisionError);
            setError(
              `${intl.formatMessage({ id: "business.quota.provisionFailed" })} ${message}`,
            );
          }
        }

        setStatus(result);
      } catch (loginError) {
        // NimbusApiError 的 detail 是服务端中文文案，直接展示。
        setError(loginError instanceof Error ? loginError.message : String(loginError));
      } finally {
        setBusy(false);
      }
    },
    [providerQuotaService, providerSettingsService, intl],
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
  const wallet = useMemo(
    () => (loggedIn && status ? status.account.wallet : null),
    [loggedIn, status],
  );

  return (
    <div className="space-y-4" data-business="nimbus-quota">
      <div className="flex items-center justify-between">
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "business.quota.description" })}
        </p>
        {loggedIn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {intl.formatMessage({ id: "business.quota.refresh" })}
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex h-20 items-center justify-center text-foreground-subtle">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : loggedIn && status?.loggedIn ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-ui-base text-foreground">{status.account.username}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void handleLogout()}
            >
              <LogOut className="size-4" />
              {intl.formatMessage({ id: "business.quota.logout" })}
            </Button>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-1 text-ui-sm font-medium text-foreground-subtle">
              {intl.formatMessage({ id: "business.quota.wallet" })}
            </div>
            <QuotaMetricRow
              label={intl.formatMessage({ id: "business.quota.available" })}
              value={formatCredits(wallet?.available ?? 0)}
            />
            <QuotaMetricRow
              label={intl.formatMessage({ id: "business.quota.availableYuan" })}
              value={`¥${creditsToYuan(wallet?.available ?? 0, wallet?.creditsPerYuan ?? 0)}`}
            />
            <QuotaMetricRow
              label={intl.formatMessage({ id: "business.quota.todaySpend" })}
              value={formatCredits(wallet?.todaySpend ?? 0)}
            />
            {wallet?.lowBalance ? (
              <p className="mt-1 text-ui-sm text-warning">
                {intl.formatMessage({ id: "business.quota.lowBalance" })}
              </p>
            ) : null}
          </div>

          {status.subscriptions.length > 0 ? (
            <div className="space-y-2">
              <div className="text-ui-sm font-medium text-foreground-subtle">
                {intl.formatMessage({ id: "business.quota.subscriptions" })}
              </div>
              {status.subscriptions.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  sub={sub}
                  creditsPerYuan={wallet?.creditsPerYuan ?? 0}
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
      ) : (
        <LoginCard busy={busy} error={error} onSubmit={handleLogin} intl={intl} />
      )}
    </div>
  );
}
