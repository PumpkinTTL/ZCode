/**
 * Nimbus 账号弹窗（Polaris 自有业务）。
 *
 * 未登录：登录表单；已登录：直接转发给 NimbusQuotaOverview（额度面板 + 图表）。
 * 面板本体在 NimbusQuotaOverview，这样「设置页内联」与「弹窗」两条入口共用同一份渲染，
 * 不会出现一处有图另一处只有文字。
 *
 * 本目录（ui/src/business/）是**自有业务前端**，与上游组件隔离：
 * 删除本目录 + services 的 business/ 目录即为整体下线。
 */
import { useCallback, useEffect, useState } from "react";
import type { QuotaStatusResult } from "@zcode/services";
import { Loader2 } from "lucide-react";
import { NimbusQuotaOverview } from "./NimbusQuotaOverview.js";
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

export interface NimbusAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /** 登录/登出/刷新成功后回调，让调用方刷新自己的摘要。 */
  onChanged?: () => void;
}

/** 登录态 + 额度的弹窗本体；ProviderQuotaSection 与升级弹窗 seam 都挂它。 */
export function NimbusAccountDialog({ open, onClose, onChanged }: NimbusAccountDialogProps) {
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
        onChanged?.();
      } catch (loginError) {
        setError(loginError instanceof Error ? loginError.message : String(loginError));
      } finally {
        setBusy(false);
      }
    },
    [providerQuotaService, onChanged],
  );

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await providerQuotaService.logout();
      setStatus({ loggedIn: false });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [providerQuotaService, onChanged]);

  const handleRefresh = useCallback(() => {
    setBusy(true);
    void refresh().finally(() => setBusy(false));
  }, [refresh]);

  const loggedIn = status?.loggedIn === true;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-business="nimbus-account">
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
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <NimbusQuotaOverview
              status={status}
              busy={busy}
              onRefresh={handleRefresh}
              onLogout={() => void handleLogout()}
            />
          </div>
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
