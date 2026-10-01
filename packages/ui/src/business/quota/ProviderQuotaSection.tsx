/**
 * 设置页「我的额度」分区（Polaris 自有业务）。
 *
 * 已登录时**直接把额度面板渲染在这里**（余额 / 套餐进度 / 近 30 天用量图表），
 * 不再退化成"一行摘要 + 点管理再开弹窗"：数据一次 getStatus 就全拿到了，
 * 没有理由再让用户多点一次。未登录仍是连接入口（登录表单在弹窗里）。
 *
 * 业务实现在 business/quota/，与上游组件隔离：删本目录 + services 的 business/ 即整体下线。
 */
import { useCallback, useEffect, useState } from "react";
import type { QuotaStatusResult } from "@zcode/services";
import { Loader2, Settings2 } from "lucide-react";
import { NimbusAccountDialog } from "./NimbusAccountDialog.js";
import { NimbusQuotaOverview } from "./NimbusQuotaOverview.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type SectionState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly value: QuotaStatusResult };

export function ProviderQuotaSection() {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SectionState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", value: await providerQuotaService.getStatus() });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [providerQuotaService]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(() => {
    setBusy(true);
    void load().finally(() => setBusy(false));
  }, [load]);

  const handleLogout = useCallback(() => {
    setBusy(true);
    void providerQuotaService
      .logout()
      .then(() => setState({ status: "ready", value: { loggedIn: false } }))
      .finally(() => setBusy(false));
  }, [providerQuotaService]);

  const loggedInStatus = state.status === "ready" && state.value.loggedIn ? state.value : null;

  return (
    <div className="space-y-4" data-business="provider-quota">
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "business.quota.description" })}
      </p>

      {loggedInStatus ? (
        <NimbusQuotaOverview
          status={loggedInStatus}
          busy={busy}
          onRefresh={handleRefresh}
          onLogout={handleLogout}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span className="min-w-0 truncate text-ui-base text-foreground">
            {state.status === "loading" ? (
              <span className="inline-flex items-center gap-2 text-foreground-subtle">
                <Loader2 className="size-4 animate-spin" />
                {intl.formatMessage({ id: "business.quota.loading" })}
              </span>
            ) : state.status === "error" ? (
              state.message
            ) : (
              intl.formatMessage({ id: "business.quota.summaryLoggedOut" })
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => setDialogOpen(true)}
          >
            <Settings2 className="size-4" />
            {intl.formatMessage({ id: "business.quota.connect" })}
          </Button>
        </div>
      )}

      <NimbusAccountDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onChanged={() => void load()}
      />
    </div>
  );
}
