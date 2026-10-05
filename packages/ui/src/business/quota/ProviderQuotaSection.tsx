/**
 * 设置页「我的额度」分区（Polaris 自有业务）。
 *
 * 已登录时**直接把额度面板渲染在这里**（余额 / 套餐进度 / 近 30 天用量图表），
 * 不再退化成"一行摘要 + 点管理再开弹窗"：数据一次 getStatus 就全拿到了，
 * 没有理由再让用户多点一次。未登录仍是连接入口（登录表单在弹窗里）。
 *
 * 业务实现在 business/quota/，与上游组件隔离：删本目录 + services 的 business/ 即整体下线。
 */
import { useCallback, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { NimbusAccountDialog } from "./NimbusAccountDialog.js";
import { NimbusQuotaOverview } from "./NimbusQuotaOverview.js";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "./nimbusAccountState.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProviderQuotaSection() {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * 「我的额度」渲染共享快照（nimbusAccountState 单一数据源），不再自己 getStatus：
   * 侧边栏底部、设置页与账号弹窗必须同时是已登录/未登录，登录后也不必等下一次交互才刷新。
   */
  const shared = useNimbusAccountState();

  const handleRefresh = useCallback(() => {
    setBusy(true);
    void refreshNimbusAccountState().finally(() => setBusy(false));
  }, []);

  const handleLogout = useCallback(() => {
    setBusy(true);
    void providerQuotaService
      .logout()
      .then(() => notifyNimbusAccountChanged({ loggedIn: false }))
      .finally(() => setBusy(false));
  }, [providerQuotaService]);

  const status = shared.status;
  const loggedInStatus = status?.loggedIn === true ? status : null;
  // 首屏 spinner 只在没有任何快照时出现；有缓存时后台重校验，不闪 loading。
  const loading = status === null && shared.loading;

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
            {loading ? (
              <span className="inline-flex items-center gap-2 text-foreground-subtle">
                <Loader2 className="size-4 animate-spin" />
                {intl.formatMessage({ id: "business.quota.loading" })}
              </span>
            ) : shared.error ? (
              shared.error
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

      {/* 弹窗自己向共享快照 notify（登录/登出），本分区订阅同一份快照即可，无需 onChanged 回流。 */}
      <NimbusAccountDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
