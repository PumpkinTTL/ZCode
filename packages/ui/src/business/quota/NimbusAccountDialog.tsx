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
import { Loader2 } from "lucide-react";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "./nimbusAccountState.js";
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
  /**
   * 面板登录态优先读共享快照（nimbusAccountState 单一数据源）：
   * 侧边栏底部、设置页「我的额度」与这个弹窗看到的是同一份状态，
   * 「一处已登录、另一处还显示登录表单」的分裂不会再出现。
   * 本组件只保留登录表单自己的 error/busy（与账号快照无关的临时交互态）。
   */
  const shared = useNimbusAccountState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // 打开即重校验：有缓存先渲染缓存，没有则等这一次结果；共享状态内部去重，不会重复打后端。
    setError(null);
    void refreshNimbusAccountState();
  }, [open]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const status = await providerQuotaService.login({ username, password });
        // 广播乐观快照：主界面（侧边栏/设置页/弹窗）立即同步，不等下一个获焦重校验。
        notifyNimbusAccountChanged(status);
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
      notifyNimbusAccountChanged({ loggedIn: false });
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [providerQuotaService, onChanged]);

  const handleRefresh = useCallback(() => {
    setBusy(true);
    void refreshNimbusAccountState().finally(() => setBusy(false));
  }, []);

  const status = shared.status;
  const loggedIn = status?.loggedIn === true;
  // 首屏 spinner 只在「没有任何快照」时出现；有缓存时后台重校验，不闪 loading。
  const loading = status === null && shared.loading;
  // 本地 error（登录表单提交失败）优先；没有快照时展示共享快照的刷新错误。
  const displayError = error ?? (status === null ? shared.error : null);

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
        ) : displayError ? (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertDescription>{displayError}</AlertDescription>
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setError(null);
                void refreshNimbusAccountState();
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
            error={displayError}
            onSubmit={(username, password) => void handleLogin(username, password)}
            intl={intl}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
