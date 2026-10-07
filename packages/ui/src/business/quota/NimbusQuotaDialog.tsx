/**
 * 侧边栏「用量额度」弹窗：点击就地弹出完整额度面板，不再走设置页跳转链。
 *
 * 为什么是弹窗：跳转链（sessionStorage 意图 + Tab initialSection + Root 透传）
 * 在设置 Tab 已存在时不会重新定位分区，且整页挂载偏卡（用户实测）。
 * 弹窗直接复用设置页同一套面板组件与共享快照：已登录 = 公告条 + 额度面板；
 * 未登录 = 极简提示 + 登录按钮转统一登录弹窗。
 */
import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { NimbusQuotaOverview } from "./NimbusQuotaOverview.js";
import { NimbusNoticeBar } from "./NimbusNoticeBar.js";
import { NimbusAccountDialog } from "./NimbusAccountDialog.js";
import { PolarisLogo } from "@/business/brand/PolarisLogo.js";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "./nimbusAccountState.js";
import { clearNimbusProviderAccess } from "./provisionNimbusProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function NimbusQuotaDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, appUpdateService } = useServices();
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  /** 与侧边栏底部/设置页同一份共享快照：弹窗里看到的就是当前真实登录态。 */
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
        // 与设置页/账号弹窗登出同语义：清理本地凭证（保留模型目录）。
        try {
          await clearNimbusProviderAccess({
            quota: providerQuotaService,
            providerSettings: providerSettingsService,
            publicModelCatalog: appUpdateService
              ? () => appUpdateService.listPublicModelIds()
              : undefined,
          });
        } catch {
          // 清理失败不阻断登出收尾；下次启动自愈补清。
        }
      })
      .finally(() => setBusy(false));
  }, [providerQuotaService, providerSettingsService]);

  const status = shared.status;
  const loggedInStatus = status?.loggedIn === true ? status : null;
  // 首屏 spinner 只在没有任何快照时出现；有缓存时后台重校验，不闪 loading。
  const loading = status === null && shared.loading;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent className="max-w-2xl" data-nimbus-quota-dialog="">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.providerQuotaTitle" })}
            </DialogTitle>
          </DialogHeader>
          {loggedInStatus ? (
            <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
              <NimbusNoticeBar />
              <NimbusQuotaOverview
                status={loggedInStatus}
                busy={busy}
                onRefresh={handleRefresh}
                onLogout={handleLogout}
              />
            </div>
          ) : loading ? (
            <div className="flex h-32 items-center justify-center text-foreground-subtle">
              <Loader2 className="size-5 animate-spin mr-2" />
              <span className="text-ui-base">
                {intl.formatMessage({ id: "business.quota.loading" })}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10">
              <PolarisLogo size={56} variant="badge" />
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "business.quota.description" })}
              </p>
              <Button className="h-9 rounded-lg px-5 text-ui-sm" onClick={() => setLoginOpen(true)}>
                {intl.formatMessage({ id: "business.quota.login" })}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* 未登录转统一登录：两个 Dialog 各自 portal 到 body，登录窗叠在额度弹窗上层。 */}
      <NimbusAccountDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
