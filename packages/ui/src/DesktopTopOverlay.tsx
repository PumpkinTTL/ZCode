import type { IPlatformService, UpdateStatePayload } from "@zcode/shared";
import { ZCODE_VERSION } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Separator } from "@/components/ui/separator.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MessageCirclePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Tag,
} from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { UpdateStatusButton } from "@/UpdateStatusButton.js";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import {
  createWindowsCaptionControlsStyle,
  WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
} from "@/windowCaptionControls.js";

interface DesktopTopOverlayProps {
  workspaceAbsPath: string;
  isMacDesktop?: boolean;
  isMacFullscreen?: boolean;
  isWindowsDesktop?: boolean;
  isDesktop?: boolean;
  macWindowControlsLeftPaddingPx?: number;
  windowsWindowControlsRightPaddingPx?: number;
  isSidebarVisible: boolean;
  updateReadyVersion: string | null;
  updateState: UpdateStatePayload | null;
  toggleSidebarShortcutLabel: string;
  newTaskShortcutLabel: string;
  goBackShortcutLabel: string;
  goForwardShortcutLabel: string;
  canTaskNavBack: boolean;
  canTaskNavForward: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  showNewTaskButton?: boolean;
  appLogoUrl: string;
  platform: IPlatformService;
  onToggleSidebar: () => void;
  onCreateTask: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  hideTaskNavigationButtons?: boolean;
  newTaskDisabledReason?: string;
}

export function DesktopTopOverlay({
  workspaceAbsPath,
  isMacDesktop,
  isMacFullscreen,
  isWindowsDesktop,
  isDesktop,
  macWindowControlsLeftPaddingPx,
  windowsWindowControlsRightPaddingPx,
  isSidebarVisible,
  updateReadyVersion,
  updateState,
  toggleSidebarShortcutLabel,
  newTaskShortcutLabel,
  goBackShortcutLabel,
  goForwardShortcutLabel,
  canTaskNavBack,
  canTaskNavForward,
  canGoBack: _canGoBack,
  canGoForward: _canGoForward,
  showNewTaskButton,
  appLogoUrl,
  platform,
  onToggleSidebar,
  onCreateTask,
  onGoBack,
  onGoForward,
  hideTaskNavigationButtons = false,
  newTaskDisabledReason,
}: DesktopTopOverlayProps) {
  const { intl } = useZCodeIntl();
  const SidebarToggleIcon = isSidebarVisible ? PanelLeftClose : PanelLeftOpen;
  const isLinuxDesktop = Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop);
  const usesCustomCaptionArea = isWindowsDesktop || isLinuxDesktop;
  const toggleSidebarTitle = intl.formatMessage({
    id: "workspaceSidebar.toggleSidebar",
  });
  const newTaskTitle = intl.formatMessage({ id: "sidebar.newTask" });
  const taskBackTitle = intl.formatMessage({ id: "taskNav.back" });
  const taskForwardTitle = intl.formatMessage({ id: "taskNav.forward" });
  const isNewTaskButtonVisible = showNewTaskButton ?? !isSidebarVisible;
  // 品牌区是桌面端左上角的平台化标识：Windows/Linux 用应用图标，macOS 沿用图标切换按钮。
  const hasBrandControl = usesCustomCaptionArea || Boolean(isMacDesktop);
  // 品牌区与操作区之间插一条细分隔符，把“应用标识”和“任务操作”分成两组。
  const showBrandSeparator =
    hasBrandControl && (!hideTaskNavigationButtons || isNewTaskButtonVisible);
  // 字标与版本号标签只在侧栏展开态出现：这里的顶栏宽度就是侧栏宽度（264px 起），有地方排。
  // 收起态顶栏宽度是按 Header 预留空间（pl-38 / pl-44）逐像素校对过的，再插文本块会顶进 Header。
  const showBrandWordmark = usesCustomCaptionArea && isSidebarVisible;
  const displayVersion = ZCODE_VERSION.startsWith("v") ? ZCODE_VERSION : `v${ZCODE_VERSION}`;
  const macTopOverlayPaddingStyle =
    isMacDesktop && !isMacFullscreen && Number.isFinite(macWindowControlsLeftPaddingPx)
      ? { paddingLeft: `${Math.round(macWindowControlsLeftPaddingPx ?? 96)}px` }
      : undefined;
  const windowsTopOverlayPaddingStyle = isWindowsDesktop
    ? {
        ...createWindowsCaptionControlsStyle(windowsWindowControlsRightPaddingPx),
        paddingRight: WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
      }
    : undefined;
  const topOverlayWidthStyle = isSidebarVisible
    ? { width: "var(--workspace-sidebar-panel-width)" }
    : undefined;

  return (
    <div
      style={topOverlayWidthStyle}
      className={cn(
        "@container/topoverlayer pointer-events-none absolute h-14 flex left-0 top-0 z-20 w-fit",
        // Windows/Linux 主面板新增 4px 留白及 1px 边框，左侧工具组需同步偏移才能对齐 Header 中心线。
        usesCustomCaptionArea && "top-1 mt-px",
      )}
    >
      <div
        style={{
          ...macTopOverlayPaddingStyle,
          ...windowsTopOverlayPaddingStyle,
        }}
        className={cn(
          "flex items-center",
          isMacDesktop && "h-14",
          usesCustomCaptionArea && "h-12",
          // Windows/Linux 工具组计入 4px 外沿留白和 1px 边框，较 8px 左边距右移 5px。
          usesCustomCaptionArea && "pl-3 ml-px",
          isMacDesktop &&
            (isMacFullscreen ? (!isSidebarVisible ? "pl-5 pt-1" : "pl-3 pt-1") : "pt-1"),
        )}
      >
        <div
          className={cn(
            // 顶部浮层按钮虽然单个按钮打了 no-drag，但外层容器本身仍悬在窗口标题区上方。
            // Electron 在这类覆盖层上会优先按父级命中拖拽区域，导致点击被窗口拖动吞掉。
            // 这里把整块交互容器一起标成 no-drag，确保展开/收起和新建 task 都能稳定点击。
            // 交互容器本身必须可收缩（min-w-0）：侧栏展开时容器宽度被固定为侧栏宽度，
            // 只有让整组参与收缩，末尾的版本标签才会先截断，而不是把更新按钮顶到侧栏外面。
            "pointer-events-auto flex min-w-0 items-center gap-1 [app-region:no-drag]",
          )}
        >
          {/* 品牌区：桌面端左上角应用标识 */}
          {usesCustomCaptionArea && (
            <div className="flex items-center gap-1.5">
              <DesktopTopOverlayActionButton
                title={toggleSidebarTitle}
                shortcut={toggleSidebarShortcutLabel}
                ariaLabel={toggleSidebarTitle}
                size="icon-md"
                buttonClassName="group relative size-7 overflow-hidden rounded-md transition-colors hover:bg-surface-hover"
                onClick={onToggleSidebar}
              >
                <img
                  src={appLogoUrl}
                  alt="Polaris"
                  className="size-5 transition-opacity duration-150 group-hover:opacity-0"
                  draggable={false}
                />
                <SidebarToggleIcon className="absolute inset-0 m-auto size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 text-foreground-muted" />
              </DesktopTopOverlayActionButton>

              {showBrandWordmark ? (
                <span className="select-none text-ui-sm font-semibold tracking-tight text-foreground/90 pl-0.5">
                  Polaris
                </span>
              ) : null}
            </div>
          )}

          {isMacDesktop && (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              size="icon-md"
              buttonClassName="size-7 rounded-md"
              onClick={onToggleSidebar}
            >
              <SidebarToggleIcon className="size-4" />
            </DesktopTopOverlayActionButton>
          )}

          {/* 品牌区与导航区精致细分隔符 */}
          {showBrandSeparator ? (
            <span className={cn("flex h-3.5 shrink-0 items-center", isSidebarVisible ? "mx-1" : "mx-0.5")}>
              <Separator orientation="vertical" className="bg-border-subtle/70" />
            </span>
          ) : null}

          {/* 任务历史导航键组 */}
          {hideTaskNavigationButtons ? null : (
            <div className="flex items-center gap-0.5">
              <DesktopTopOverlayActionButton
                title={taskBackTitle}
                shortcut={goBackShortcutLabel}
                ariaLabel={taskBackTitle}
                testId="desktop-top-nav-back"
                size="icon-sm"
                disabled={!canTaskNavBack}
                onClick={onGoBack}
                buttonClassName="rounded-md text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-25"
              >
                <ArrowLeftIcon className="size-3.5" />
              </DesktopTopOverlayActionButton>
              <DesktopTopOverlayActionButton
                title={taskForwardTitle}
                shortcut={goForwardShortcutLabel}
                ariaLabel={taskForwardTitle}
                size="icon-sm"
                disabled={!canTaskNavForward}
                onClick={onGoForward}
                buttonClassName="rounded-md text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-25"
              >
                <ArrowRightIcon className="size-3.5" />
              </DesktopTopOverlayActionButton>
            </div>
          )}

          <div
            aria-hidden={!isNewTaskButtonVisible}
            className={cn(
              "inline-flex overflow-hidden transition-[opacity,width] duration-300 ease-out",
              isNewTaskButtonVisible ? "w-7 opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <DesktopTopOverlayActionButton
              title={newTaskDisabledReason ?? newTaskTitle}
              shortcut={newTaskShortcutLabel}
              ariaLabel={newTaskTitle}
              size="icon-sm"
              disabled={Boolean(newTaskDisabledReason)}
              onClick={onCreateTask}
              buttonClassName="rounded-md text-foreground-subtle hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-25"
            >
              <MessageCirclePlus className="size-3.5" />
            </DesktopTopOverlayActionButton>
          </div>

          {/* 应用版本徽标：替换原工作区标签，简洁精致并具备清晰视觉层次 */}
          {isDesktop && isSidebarVisible ? (
            <ControlHintTooltip
              title={workspaceAbsPath ? `Polaris ${displayVersion} • ${workspaceAbsPath}` : `Polaris ${displayVersion}`}
              side="bottom"
            >
              <div className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-subtle/50 bg-surface-subtle/50 px-2 py-0.5 text-ui-xs font-mono font-medium text-foreground-subtle select-none transition-colors hover:bg-surface-hover/80 hover:text-foreground">
                <Tag className="size-3 shrink-0 text-foreground-subtlest" />
                <span>{displayVersion}</span>
              </div>
            </ControlHintTooltip>
          ) : null}

          {/* <div className="flex items-center [app-region:no-drag]"> */}
          {/* 侧栏收起后，更新按钮之前会跟着“展开态的容器宽度阈值”一起被隐藏。
                  但收起态本身已经改成把操作集中到顶部浮层里，如果这里还继续依赖侧栏宽度判断，
                  用户就会在最需要全局入口的时候反而看不到更新按钮。
                  所以展开态继续走容器查询，收起态则强制显示。 */}
          <UpdateStatusButton
            platform={platform}
            version={updateReadyVersion}
            updateState={updateState}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
          />
          {/* </div> */}
        </div>
      </div>
    </div>
  );
}
