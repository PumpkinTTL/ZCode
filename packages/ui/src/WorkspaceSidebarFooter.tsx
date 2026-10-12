/* oxlint-disable eslint(max-lines) -- footer 聚合账户、主题、模式和快捷键菜单。 */
import type { Locale, UserInfo } from "@zcode/shared";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  DesktopCommandIds,
  TID_LOGIN_MENU_ITEM,
  TID_LOGIN_TRIGGER,
  TID_LOGOUT_BUTTON,
  TID_SIDEBAR_QUOTA_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
} from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  PencilRuler,
  Globe,
  Loader2,
  LogInIcon,
  LogOut,
  Maximize,
  Palette,
  Settings,
  History as HistoryIcon,
  User,
  Wallet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { normalizeInterfaceMode } from "@/lib/interfaceMode.js";
import type { Theme } from "@/useTheme.js";
import { WorkspaceWebRemoteControlTrigger } from "@/WorkspaceWebRemoteControlTrigger.js";
import { WorkspaceSidebarFooterUsageSummaryContent } from "@/WorkspaceSidebarFooterUsageSummary.js";
import { NimbusAppUpdateDialog } from "@/business/appUpdate/NimbusAppUpdateDialog.js";
import {
  clearNimbusProviderAccess,
  ensureOfficialDefaultModel,
  provisionNimbusProvider,
} from "@/business/quota/provisionNimbusProvider.js";
import { NimbusQuotaSidePanel } from "@/business/quota/NimbusQuotaSidePanel.js";
import { logger } from "@/logger.js";
import {
  notifyNimbusAccountChanged,
  refreshNimbusAccountState,
  useNimbusAccountState,
} from "@/business/quota/nimbusAccountState.js";

const DESKTOP_ZOOM_MIN_LEVEL = -3;
const DESKTOP_ZOOM_MAX_LEVEL = 5;

function getSidebarProfileName(user?: UserInfo | null): string {
  const displayName = user?.displayName?.trim();
  if (displayName) {
    return displayName;
  }

  const username = user?.username?.trim();
  if (username) {
    return username;
  }

  return "Polaris";
}

function getSidebarProfileBadge(
  user: UserInfo | null | undefined,
  formatMessage: ReturnType<typeof useZCodeIntl>["intl"]["formatMessage"],
): string {
  if (user) {
    return getSidebarProfileName(user);
  }

  return formatMessage({ id: "sidebar.profile.notLoggedIn" });
}

function getAvatarFallbackText(user: UserInfo | null | undefined): string {
  const source = user?.displayName?.trim() || user?.username?.trim() || "Z";
  return source[0]?.toUpperCase() ?? "Z";
}

export const WorkspaceSidebarFooter = memo(function WorkspaceSidebarFooterComponent({
  theme,
  localeMenuValue,
  onLocaleChange,
  onThemeChange,
  onSettingsButtonClick,
  onUsageClick,
  onLogin,
  settingsButtonMode = "settings",
  user,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  activeTaskId,
  isDesktop = false,
  className,
}: {
  theme: Theme;
  localeMenuValue: Locale | "system";
  onLocaleChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onSettingsButtonClick?: () => void;
  onUsageClick?: () => void;
  onLogin?: () => void;
  settingsButtonMode?: "settings" | "back";
  user?: UserInfo | null;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activeTaskId?: string | null;
  isDesktop?: boolean;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const interfaceMode = useZCodeStore((state) => state.interfaceMode);
  const setInterfaceMode = useZCodeStore((state) => state.setInterfaceMode);
  const zoomInShortcutLabel = useShortcutCommandLabel("zoomIn");
  const zoomOutShortcutLabel = useShortcutCommandLabel("zoomOut");
  const resetZoomShortcutLabel = useShortcutCommandLabel("resetZoom");
  const isRestoringOAuthSession = useZCodeStore((state) => state.isRestoringOAuthSession);
  const { providerQuotaService, providerSettingsService, appUpdateService, modelSelectionService } =
    useServices();
  // Nimbus（自有中转站）登录态走共享快照：与设置页「我的额度」、账号弹窗同一份数据源。
  // 底部账号身份以它为准（上游 OAuth user 在 Polaris 已无官方账号通路，通常为空）。
  const nimbusAccount = useNimbusAccountState();
  const nimbusLoggedIn = nimbusAccount.loggedIn;
  const nimbusUsername = nimbusAccount.username?.trim() ?? "";
  const profileBadge = nimbusLoggedIn
    ? nimbusUsername || getSidebarProfileName(user)
    : getSidebarProfileBadge(user, intl.formatMessage);
  const avatarFallbackText = nimbusLoggedIn
    ? (nimbusUsername[0]?.toUpperCase() ?? "P")
    : getAvatarFallbackText(user);
  const avatarKey = nimbusLoggedIn
    ? `nimbus:${nimbusUsername || "account"}`
    : (user?.avatarUrl ?? user?.id ?? "guest");
  const showAuthRestoreLoading = !user && !nimbusLoggedIn && isRestoringOAuthSession;
  // 已登录会话的补开通：登录动作在 WelcomeScreen 开通一次，但「先登录、后升级到带开通逻辑的
  // 版本」或登录发生在别处时，供应商会缺席。footer 在登录后常驻，这里每次挂载补跑一次：
  // 幂等（复用既有供应商 / 同源手工供应商 → 刷新密钥 → 置顶），失败只记日志，绝不打断 UI。
  const provisionAttemptedRef = useRef(false);
  useEffect(() => {
    // 未登录（含刚登出）时复位补开通标记：登出会清掉覆盖层凭证，同一挂载内
    // 重新登录必须再开通一次（key+基址+模型），否则模型在菜单里但调用无凭证。
    if (!nimbusLoggedIn) {
      provisionAttemptedRef.current = false;
      return;
    }
    if (provisionAttemptedRef.current) return;
    provisionAttemptedRef.current = true;
    void provisionNimbusProvider({
      quota: providerQuotaService,
      providerSettings: providerSettingsService,
    })
      .then((result) =>
        // 官方默认模型兜底：WelcomeScreen 登录已即时写过一次；账号弹窗等间接登录路径
        // 只走到这里。幂等（已有默认不覆盖），失败只记日志。
        ensureOfficialDefaultModel({
          providerId: result.providerId,
          modelSelection: modelSelectionService,
          logger,
        }),
      )
      .catch((error: unknown) => {
        logger.warn("[WorkspaceSidebarFooter] 已登录会话补开通 Nimbus 供应商失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [nimbusLoggedIn, providerQuotaService, providerSettingsService, modelSelectionService]);
  // 启动自愈：确认未登录时清掉历史残留的 Nimbus 覆盖层（旧版本登出未清理的存量）。
  useEffect(() => {
    if (nimbusLoggedIn || nimbusAccount.status === null) return;
    void clearNimbusProviderAccess({
      quota: providerQuotaService,
      providerSettings: providerSettingsService,
      publicModelCatalog: appUpdateService ? () => appUpdateService.listPublicModelIds() : undefined,
    }).catch(() => {
      // 无覆盖层时是 no-op；异常不打断 UI。
    });
  }, [nimbusAccount.status, nimbusLoggedIn, providerQuotaService, providerSettingsService]);
  /** Nimbus 登出：先弹确认，确认后才清本地凭证。 */
  const [nimbusLogoutConfirmOpen, setNimbusLogoutConfirmOpen] = useState(false);
  /** 更新日志弹窗（头像菜单入口）。 */
  const [appUpdateOpen, setAppUpdateOpen] = useState(false);
  const handleNimbusLogout = useCallback(() => {
    setNimbusLogoutConfirmOpen(true);
  }, []);
  const confirmNimbusLogout = useCallback(() => {
    setNimbusLogoutConfirmOpen(false);
    void providerQuotaService.logout().then(
      async () => {
        notifyNimbusAccountChanged({ loggedIn: false });
        // 登出清内部凭证：删掉 Nimbus 覆盖层的 sk- 密钥与基址，保留模型目录
        //（模型仍在选择菜单里、置灰锁定不可选）；失败只记日志（下次启动自愈会补清）。
        try {
          await clearNimbusProviderAccess({
            quota: providerQuotaService,
            providerSettings: providerSettingsService,
          });
        } catch (error) {
          logger.warn("[WorkspaceSidebarFooter] 登出清理 Nimbus 供应商失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      () => refreshNimbusAccountState(),
    );
  }, [providerQuotaService, providerSettingsService]);
  const profileContent = (
    <>
      <Avatar key={avatarKey} size="default">
        {user?.avatarUrl && !nimbusLoggedIn ? (
          <AvatarImage src={user.avatarUrl} alt={profileBadge} />
        ) : null}
        <AvatarFallback className="bg-background text-foreground">
          {nimbusLoggedIn || user ? (
            avatarFallbackText
          ) : showAuthRestoreLoading ? (
            <>
              {/* OAuth 启动恢复未落定前，footer 之前会直接显示未登录头像，
                  用户很容易把“还在校验”误判成“已经退出”。
                  这里用 loading 图标明确表达“状态确认中”，等恢复成功或失败后再展示最终状态。 */}
              <Loader2 className="size-4 animate-spin" />
              <span className="sr-only">{intl.formatMessage({ id: "common.loading" })}</span>
            </>
          ) : (
            <User className="size-4" />
          )}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 overflow-hidden text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-ui-base font-semibold text-foreground">
            {profileBadge}
          </span>
        </div>
      </div>
    </>
  );
  const settingsButtonLabel =
    settingsButtonMode === "back"
      ? intl.formatMessage({ id: "workspace.backToWorkspace" })
      : intl.formatMessage({ id: "settings.title" });
  const usageButtonClick = onUsageClick ?? onSettingsButtonClick;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  /** 「用量额度」菜单项：就地打开侧边额度面板（不再走设置页跳转链；设置页
   * 「我的额度」分区经面板底部「偏好设置」仍可达）。未登录的登录引导由面板内承接。 */
  const [quotaPanelOpen, setQuotaPanelOpen] = useState(false);
  const openQuotaPanel = useCallback(() => setQuotaPanelOpen(true), []);
  const [desktopZoomLevel, setDesktopZoomLevel] = useState(0);
  const runDesktopZoomCommand = useCallback(
    (command: (typeof DesktopCommandIds)["ZoomIn" | "ZoomOut" | "ResetZoom"]) => {
      void platform.executeDesktopCommand(command);
    },
    [platform],
  );

  useEffect(() => {
    if (!isDesktop) {
      setDesktopZoomLevel(0);
      return;
    }

    let isCancelled = false;
    void platform.getDesktopZoomLevel?.().then((state) => {
      if (!isCancelled && Number.isFinite(state.zoomLevel)) {
        setDesktopZoomLevel(state.zoomLevel);
      }
    });

    const dispose = platform.onDesktopZoomLevelChanged?.((state) => {
      if (Number.isFinite(state.zoomLevel)) {
        setDesktopZoomLevel(state.zoomLevel);
      }
    });

    return () => {
      isCancelled = true;
      dispose?.();
    };
  }, [isDesktop, platform]);

  const canResetDesktopZoom = desktopZoomLevel !== 0;
  const canZoomIn = desktopZoomLevel < DESKTOP_ZOOM_MAX_LEVEL;
  const canZoomOut = desktopZoomLevel > DESKTOP_ZOOM_MIN_LEVEL;

  return (
    // footer 被 Settings 复用，页面专属边距由调用方传入，避免修改共享默认样式。
    <footer className={cn("flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4", className)}>
      <div className="flex min-w-0 gap-2">
        <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
          <DropdownMenuTrigger asChild>
            {/* 头像和 Login 之前直接绑定到登录动作，导致用户无法从这里打开偏好设置。
              现在把这一块改成统一的设置菜单入口，登录/退出留在菜单项里，交互职责更清晰。 */}
            <Button
              type="button"
              variant="ghost"
              size={"lg"}
              className="min-w-0 flex-1 justify-start gap-2 overflow-hidden rounded-tl-2xl rounded-bl-2xl border-0 pl-0"
              data-testid={TID_LOGIN_TRIGGER}
              aria-label={profileBadge}
            >
              {/* Button 默认 shrink-0 且带 whitespace-nowrap，超长用户名会把 footer 撑出 sidebar。
                这里让触发按钮和文本列都允许收缩，并只在用户名自身做单行截断。 */}
              {profileContent}
            </Button>
          </DropdownMenuTrigger>
          {/* 菜单内容保持挂载，避免每次点击头像菜单都重建 footer 内部状态。*/}
          <DropdownMenuContent align="start" className="w-max min-w-50" forceMount>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Globe className="size-4" />
                {intl.formatMessage({ id: "settings.locale" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup value={localeMenuValue} onValueChange={onLocaleChange}>
                  <DropdownMenuRadioItem value="system">
                    {intl.formatMessage({
                      id: "sidebar.settings.systemDefault",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="en-US">
                    {intl.formatMessage({
                      id: "sidebar.settings.locale.en-US",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zh-CN">
                    {intl.formatMessage({
                      id: "sidebar.settings.locale.zh-CN",
                    })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="size-4" />
                {intl.formatMessage({ id: "settings.themeMode" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup value={theme} onValueChange={onThemeChange}>
                  <DropdownMenuRadioItem value="system">
                    {intl.formatMessage({
                      id: "sidebar.settings.systemDefault",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zai-dark">
                    {intl.formatMessage({
                      id: "sidebar.settings.theme.zai-dark",
                    })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="zai-light">
                    {intl.formatMessage({
                      id: "sidebar.settings.theme.zai-light",
                    })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PencilRuler className="size-4" />
                {intl.formatMessage({ id: "settings.interfaceMode" })}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup
                  value={interfaceMode}
                  onValueChange={(value) => setInterfaceMode(normalizeInterfaceMode(value))}
                >
                  <DropdownMenuRadioItem value="coding">
                    {intl.formatMessage({ id: "settings.interfaceMode.coding" })}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="office">
                    {intl.formatMessage({ id: "settings.interfaceMode.office" })}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* 快捷键设置：缩放子菜单 label 读生效表，设置页改绑后即时跟随 */}
            {/* 收口重复缩放子菜单时误留了语言之后的那份，导致菜单顺序变成
                语言→缩放→主题；账户菜单分组顺序固定为 语言→主题→界面模式→缩放→用量→登录/登出，
                这里把唯一一份（读生效表）挪回用量摘要之前，不要再补第二份缩放子菜单。 */}
            {isDesktop ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ZoomIn className="size-4" />
                  {intl.formatMessage({ id: "sidebar.settings.interfaceZoom" })}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-50">
                  <DropdownMenuItem
                    disabled={!canZoomIn}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ZoomIn)}
                  >
                    <ZoomIn className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.zoomIn" })}
                    <DropdownMenuShortcut>{zoomInShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canZoomOut}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ZoomOut)}
                  >
                    <ZoomOut className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.zoomOut" })}
                    <DropdownMenuShortcut>{zoomOutShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canResetDesktopZoom}
                    onSelect={() => runDesktopZoomCommand(DesktopCommandIds.ResetZoom)}
                  >
                    <Maximize className="size-4" />
                    {intl.formatMessage({ id: "titleBar.menu.view.actualSize" })}
                    <DropdownMenuShortcut>{resetZoomShortcutLabel}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {/* 升级入口状态不再以菜单开关为生命周期边界。*/}
            <WorkspaceSidebarFooterUsageSummaryContent onUsageClick={usageButtonClick} />
            {/* 「用量额度」：打开侧边额度面板（就地弹层，设置页入口经面板底部保留）。 */}
            <DropdownMenuItem
              data-testid={TID_SIDEBAR_QUOTA_USAGE_BUTTON}
              onSelect={openQuotaPanel}
            >
              <Wallet className="size-4" />
              {intl.formatMessage({ id: "sidebar.usage.quota.open" })}
            </DropdownMenuItem>
            {/* Nimbus 已登录时隐藏「登录」入口（已连接无需再连），登出改走 Nimbus 账号。 */}
            {onLogin && !user && !nimbusLoggedIn ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onLogin} data-testid={TID_LOGIN_MENU_ITEM}>
                  <LogInIcon className="size-4" />
                  {intl.formatMessage({ id: "app.login" })}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setAppUpdateOpen(true)}
              data-testid="workspace-sidebar-app-update"
            >
              <HistoryIcon className="size-4" />
              {intl.formatMessage({ id: "business.appUpdate.title" })}
            </DropdownMenuItem>
            {nimbusLoggedIn ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleNimbusLogout} data-testid={TID_LOGOUT_BUTTON}>
                  <LogOut className="size-4" />
                  {intl.formatMessage({ id: "app.logout" })}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex shrink-0 items-center gap-1.5">
          {isDesktop && workspacePath ? (
            <WorkspaceWebRemoteControlTrigger
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              compact
            />
          ) : null}
          <ControlHintTooltip title={settingsButtonLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              data-testid={TID_TASK_SETTINGS_BUTTON}
              aria-label={settingsButtonLabel}
              disabled={!onSettingsButtonClick}
              onClick={onSettingsButtonClick}
            >
              <Settings className="size-4" />
            </Button>
          </ControlHintTooltip>
        </div>
      </div>
      <NimbusAppUpdateDialog open={appUpdateOpen} onClose={() => setAppUpdateOpen(false)} />
      {/* 「用量额度」侧边面板：挂在菜单之外独立存活（入口见上方菜单项）。 */}
      <NimbusQuotaSidePanel
        open={quotaPanelOpen}
        onOpenChange={setQuotaPanelOpen}
        onLogin={onLogin}
      />
      {/* 登出确认：防误触（与上游 OAuth 登出同款交互模式）。 */}
      <AlertDialog open={nimbusLogoutConfirmOpen} onOpenChange={setNimbusLogoutConfirmOpen}>
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
            <AlertDialogCancel onClick={() => setNimbusLogoutConfirmOpen(false)}>
              {intl.formatMessage({ id: "business.quota.logoutConfirmCancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmNimbusLogout}>
              {intl.formatMessage({ id: "business.quota.logoutConfirmOk" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </footer>
  );
});
