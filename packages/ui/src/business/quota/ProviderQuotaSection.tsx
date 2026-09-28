/**
 * 设置页「我的额度」分区（Polaris 自有业务）。
 *
 * 本体是 NimbusAccountDialog 弹窗（登录 + 额度一屏）；这里只是入口与摘要：
 * 未登录显示「连接」，已登录显示账号与可用余额，点「管理」再开弹窗。
 * 业务实现在 business/quota/，与上游组件隔离：删本目录 + services 的 business/ 即整体下线。
 */
import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { NimbusAccountDialog } from "@/business/quota/NimbusAccountDialog.js";

export function ProviderQuotaSection() {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [summary, setSummary] = useState<
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "loggedOut" }
    | { state: "loggedIn"; username: string; left: string }
  >({ state: "loading" });

  const refresh = useCallback(async () => {
    try {
      const status = await providerQuotaService.getStatus();
      setSummary(
        status.loggedIn
          ? {
              state: "loggedIn",
              username: status.account.username,
              left: status.quota.left.toLocaleString(),
            }
          : { state: "loggedOut" },
      );
    } catch (error) {
      setSummary({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [providerQuotaService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 弹窗关闭后回读一次（登录/登出/刷新都会改变摘要）。
  useEffect(() => {
    if (!dialogOpen) void refresh();
  }, [dialogOpen, refresh]);

  const summaryText =
    summary.state === "loading"
      ? intl.formatMessage({ id: "business.quota.loading" })
      : summary.state === "error"
        ? summary.message
        : summary.state === "loggedIn"
          ? intl.formatMessage(
              { id: "business.quota.summaryLoggedIn" },
              { username: summary.username, left: summary.left },
            )
          : intl.formatMessage({ id: "business.quota.summaryLoggedOut" });

  return (
    <div className="space-y-4" data-business="provider-quota">
      <p className="text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "business.quota.description" })}
      </p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <span className="min-w-0 truncate text-ui-base text-foreground">{summaryText}</span>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => setDialogOpen(true)}
        >
          <Settings2 className="size-4" />
          {intl.formatMessage({
            id: summary.state === "loggedIn" ? "business.quota.manage" : "business.quota.connect",
          })}
        </Button>
      </div>
      <NimbusAccountDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
