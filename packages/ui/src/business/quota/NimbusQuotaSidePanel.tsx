/**
 * 侧边「用量额度」面板：侧栏账户区「用量额度」入口的就地弹层（Lyra 账户弹层同款形态）。
 *
 * 形态：Dialog 变体 + 自定义定位类——贴窗口左下（侧栏账户区上方）的浮层，宽 380px，
 * 不遮罩整页（showOverlay=false），点外部 / Esc 关闭。内容自上而下：
 * 账户头部（头像/用户名/刷新·关闭）→ 公告条（可选）→ 积分余额卡 → 套餐额度卡
 * （5 小时窗口 / 本周窗口进度条 + 重置时刻 + 重置卡徽章）→ 每日签到 → 底部
 * （偏好设置 / 退出登录）。
 *
 * 数据全部走现有服务，不新造数据链：登录态/用户名/重置卡数量走
 * useNimbusAccountState 共享快照（打开即 refreshNimbusAccountState 求一次真相），
 * 登出走 providerQuotaService.logout + notifyNimbusAccountChanged（与侧栏账户菜单
 * 同一套收尾：清理本地凭证覆盖层，失败只记日志/提示，不静默）。
 *
 * 复用而非重写：公告条 NimbusNoticeBar、签到 NimbusCheckinCard、重置卡弹窗
 * NimbusResetCardsDialog、余额/套餐两张展示卡 NimbusQuotaSidePanelCards 均为现有
 * 部件；本文件只负责外壳、四态（未登录引导 / 首载 / 已登录 / 登出确认）与入口落点。
 */
import { useCallback, useEffect, useState } from "react";
import type { QuotaStatusResult } from "@zcode/services";
import { Loader2, LogInIcon, RefreshCw, User, XIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { NimbusCheckinCard } from "./NimbusCheckinCard.js";
import { NimbusNoticeBar } from "./NimbusNoticeBar.js";
import { NimbusResetCardsDialog } from "./NimbusResetCardsDialog.js";
import { NimbusQuotaPlanCard, NimbusQuotaWalletCard } from "./NimbusQuotaSidePanelCards.js";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "./nimbusAccountState.js";
import { clearNimbusProviderAccess } from "./provisionNimbusProvider.js";

export function NimbusQuotaSidePanel({
  open,
  onOpenChange,
  onLogin,
}: {
  /** 面板开关（受控；入口在 WorkspaceSidebarFooter 的「用量额度」菜单项）。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 未登录引导的登录入口（复用侧栏统一登录动作；缺省只显示提示文案）。 */
  onLogin?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService, providerSettingsService, appUpdateService } = useServices();
  /** 与侧栏底部 / 设置页「我的额度」同一份共享快照：面板里看到的就是当前真实登录态。 */
  const account = useNimbusAccountState();
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const [resetCardsOpen, setResetCardsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // 打开即刷新一次额度：面板展示的必须是打开这一刻的真相，不能停在缓存等手动刷新。
  // bustInFlight 不共享在途请求——在途那发可能起飞于别处的入账之前（与 Lyra 同口径）。
  useEffect(() => {
    if (open) void refreshNimbusAccountState({ bustInFlight: true });
  }, [open]);

  const handleRefresh = useCallback(() => {
    void refreshNimbusAccountState();
  }, []);

  /** 底部「偏好设置」：回到设置页「我的额度」分区（原入口的落点原地保留）。 */
  const handleOpenPreferences = useCallback(() => {
    setResetCardsOpen(false);
    onOpenChange(false);
    setPendingSettingsSection("providerQuota");
    openSettingsTab("providerQuota");
  }, [onOpenChange, openSettingsTab]);

  /** 底部「退出登录」：先弹确认（与侧栏账户菜单同款防误触），确认后才清本地凭证。 */
  const confirmLogout = useCallback(() => {
    setLogoutConfirmOpen(false);
    void providerQuotaService.logout().then(
      async () => {
        notifyNimbusAccountChanged({ loggedIn: false });
        // 登出清内部凭证：删掉 Nimbus 覆盖层的 sk- 密钥与基址，保留模型目录
        //（模型仍在选择菜单里、置灰锁定不可选）；失败只记日志（下次启动自愈会补清）。
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
      },
      (error: unknown) => {
        // 服务端登出失败（网络/后端故障）不能静默：凭证还在，用户会误以为已登出。
        toast(error instanceof Error ? error.message : String(error), { variant: "warning" });
        void refreshNimbusAccountState({ bustInFlight: true });
      },
    );
  }, [providerQuotaService, providerSettingsService, appUpdateService]);

  const status = account.status;
  const loggedInStatus: Extract<QuotaStatusResult, { loggedIn: true }> | null =
    status !== null && status.loggedIn ? status : null;
  // 首屏 spinner 只在没有任何快照时出现；有缓存时后台重校验，不闪 loading。
  const loading = status === null && account.loading;
  const username = account.username?.trim() ?? "";
  const avatarInitials = (username || "P").slice(0, 2).toUpperCase();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showOverlay={false}
          showCloseButton={false}
          data-nimbus-quota-side-panel=""
          className={cn(
            // 贴侧边的浮层（Dialog 变体 + 自定义定位）：默认 DialogContent 是视口居中，
            // 这里改成钉在窗口左下（侧栏账户区上方），高度随内容、超出内部滚动。
            "fixed top-auto bottom-4 left-4 z-50 flex max-h-[min(640px,calc(100vh-2rem))] w-[380px] max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border border-popover-border bg-popover p-0 text-ui-base text-foreground shadow-md",
          )}
        >
          {/* 无障碍标题（视觉上由头部身份行承担） */}
          <DialogTitle className="sr-only">
            {intl.formatMessage({ id: "settings.providerQuotaTitle" })}
          </DialogTitle>

          {/* 账户头部：头像 + 用户名（+ 掩码邮箱）+ 刷新 / 关闭 */}
          <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="default">
                <AvatarFallback className="bg-surface text-ui-sm font-semibold text-foreground">
                  {loggedInStatus ? (
                    avatarInitials
                  ) : (
                    <User className="size-4" aria-hidden="true" />
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-ui-sm font-semibold text-foreground">
                  {loggedInStatus
                    ? username
                    : intl.formatMessage({ id: "settings.providerQuotaTitle" })}
                </div>
                {loggedInStatus?.account.emailMasked ? (
                  <div className="truncate font-mono text-ui-xs text-foreground-subtle">
                    {loggedInStatus.account.emailMasked}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer text-foreground-subtle hover:text-foreground"
                title={intl.formatMessage({ id: "business.quota.refresh" })}
                aria-label={intl.formatMessage({ id: "business.quota.refresh" })}
                disabled={account.loading}
                onClick={handleRefresh}
              >
                <RefreshCw className={cn("size-3.5", account.loading && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer text-foreground-subtle hover:text-foreground"
                title={intl.formatMessage({ id: "common.close" })}
                aria-label={intl.formatMessage({ id: "common.close" })}
                onClick={() => onOpenChange(false)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          </header>

          {/* 主体：三态（已登录数据 / 首载 / 未登录引导） */}
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
            {loggedInStatus ? (
              <>
                {/* 公告条（有公告才渲染，同一份已读记忆与设置页共享） */}
                <NimbusNoticeBar />
                <NimbusQuotaWalletCard wallet={loggedInStatus.account.wallet} />
                <NimbusQuotaPlanCard
                  status={loggedInStatus}
                  resetCardCount={account.resetCardCount}
                  onOpenResetCards={() => setResetCardsOpen(true)}
                />
                {/* 每日签到：连签天数 + 签到按钮（连签/奖励反馈走全局 toast） */}
                <NimbusCheckinCard />
              </>
            ) : loading ? (
              <div className="flex h-28 items-center justify-center gap-2 text-foreground-subtle">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-ui-sm">
                  {intl.formatMessage({ id: "business.quota.loading" })}
                </span>
              </div>
            ) : (
              // 未登录引导：提示 + 登录按钮（复用统一登录入口；登录页关闭后回到本面板）。
              <div className="flex h-36 flex-col items-center justify-center gap-3 text-center">
                <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
                  <LogInIcon className="size-4" aria-hidden="true" />
                  {intl.formatMessage({ id: "business.quota.loginRequiredHint" })}
                </div>
                {account.error ? (
                  <p className="max-w-[17rem] break-all text-ui-xs text-warning">
                    {account.error}
                  </p>
                ) : null}
                {onLogin ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 cursor-pointer rounded-lg px-4 text-ui-sm font-medium"
                    data-testid="quota-side-panel-login-cta"
                    onClick={onLogin}
                  >
                    {intl.formatMessage({ id: "business.quota.loginCta" })}
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          {/* 底部：偏好设置 / 退出登录（Lyra 账户弹层同款文本动作行） */}
          <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-3.5 py-2.5 text-ui-xs">
            <button
              type="button"
              className="cursor-pointer text-foreground-subtle transition-colors hover:text-foreground"
              onClick={handleOpenPreferences}
            >
              {intl.formatMessage({ id: "business.quota.sidePanelPreferences" })}
            </button>
            {loggedInStatus ? (
              <>
                <span className="select-none text-border">·</span>
                <button
                  type="button"
                  className="cursor-pointer text-foreground-subtle transition-colors hover:text-destructive"
                  onClick={() => setLogoutConfirmOpen(true)}
                >
                  {intl.formatMessage({ id: "business.quota.logout" })}
                </button>
              </>
            ) : null}
          </footer>
        </DialogContent>
      </Dialog>

      {/* 重置卡弹窗：面板 Dialog 的兄弟节点（各自 portal 到 body）——面板关闭不影响它，
          反之亦然；点它内部不会把面板当作「外部交互」关掉（radix 层分支判定）。 */}
      {loggedInStatus ? (
        <NimbusResetCardsDialog
          open={resetCardsOpen}
          onClose={() => setResetCardsOpen(false)}
          status={loggedInStatus}
          onManage={handleOpenPreferences}
        />
      ) : null}

      {/* 登出确认：与侧栏账户菜单同款防误触交互。 */}
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "business.quota.logoutConfirmTitle" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: "business.quota.logoutConfirmBody" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLogoutConfirmOpen(false)}>
              {intl.formatMessage({ id: "business.quota.logoutConfirmCancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmLogout}>
              {intl.formatMessage({ id: "business.quota.logoutConfirmOk" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
