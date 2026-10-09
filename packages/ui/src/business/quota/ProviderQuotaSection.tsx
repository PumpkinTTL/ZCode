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
import { Loader2, LogInIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { NimbusQuotaOverview } from "./NimbusQuotaOverview.js";
import { NimbusNoticeBar } from "./NimbusNoticeBar.js";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "./nimbusAccountState.js";
import { clearNimbusProviderAccess } from "./provisionNimbusProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ProviderQuotaSection({
  onLogin,
}: {
  /** 未登录引导卡的登录入口（打开统一登录页）。可选：缺省只显示提示文案。 */
  onLogin?: () => void;
} = {}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, appUpdateService } = useServices();
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
      .then(async () => {
        notifyNimbusAccountChanged({ loggedIn: false });
        // 设置页登出原先漏掉了本地凭证清理：覆盖层里的 sk- 密钥/基址仍然可用，
        // 与侧栏/弹窗登出行为不一致。这里补上（保留模型目录，同 clearNimbusProviderAccess 语义）。
        try {
          await clearNimbusProviderAccess({
            quota: providerQuotaService,
            providerSettings: providerSettingsService,
            publicModelCatalog: appUpdateService ? () => appUpdateService.listPublicModelIds() : undefined,
          });
        } catch {
          // 清理失败不阻断登出收尾；下次启动自愈补清。
        }
      })
      .catch((error: unknown) => {
        // 服务端登出失败（网络/后端故障）不能静默：凭证还在，用户会误以为已登出。
        // 提示并回读真实登录态，让三处额度 UI 与服务端事实收敛。
        toast(error instanceof Error ? error.message : String(error), { variant: "warning" });
        void refreshNimbusAccountState({ bustInFlight: true });
      })
      .finally(() => setBusy(false));
  }, [providerQuotaService, providerSettingsService]);

  const status = shared.status;
  const loggedInStatus = status?.loggedIn === true ? status : null;
  // 首屏 spinner 只在没有任何快照时出现；有缓存时后台重校验，不闪 loading。
  const loading = status === null && shared.loading;

  return (
    <div className="space-y-4" data-business="provider-quota">
      {/* 系统公告条（免登录端点）：与登录页同一组件、同一份已读记忆；无公告不占位。 */}
      <NimbusNoticeBar />
      {loggedInStatus ? (
        <NimbusQuotaOverview
          status={loggedInStatus}
          busy={busy}
          onRefresh={handleRefresh}
          onLogout={handleLogout}
        />
      ) : loading ? (
        <div className="flex h-32 items-center justify-center text-foreground-subtle">
          <Loader2 className="size-5 animate-spin mr-2" />
          <span className="text-ui-base">{intl.formatMessage({ id: "business.quota.loading" })}</span>
        </div>
      ) : (
        // 未登录引导卡：提示 + 显式登录按钮。曾在此分区挂载时自动强开登录页，
        // 那会让 X 关闭后立刻重开（设置页随欢迎页卸载/重挂载的死循环），所以
        // 登录必须是用户主动点击。
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
          <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
            <LogInIcon className="size-4" aria-hidden />
            {intl.formatMessage({ id: "business.quota.loginRequiredHint" })}
          </div>
          {onLogin ? (
            <Button size="sm" onClick={onLogin} data-testid="quota-login-cta">
              {intl.formatMessage({ id: "business.quota.loginCta" })}
            </Button>
          ) : null}
        </div>
      )}

    </div>
  );
}
