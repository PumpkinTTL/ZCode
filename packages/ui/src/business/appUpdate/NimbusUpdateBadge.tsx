/**
 * 「有新版本」徽标（顶部条）：独立小组件，常驻监听服务端更新目录，发现新版本时
 * 在旁边亮出「新版本」标签，点开即「更新日志」弹窗（完整的检查/说明/下载入口）。
 *
 * 与 UpdateStatusButton 的关系：后者接的是打包版 electron-updater 的下载/安装状态
 * （dev 恒空）；本徽标走的是中转站公开目录（appUpdateService.checkForUpdate，
 * /app-updates/{client}/latest），两条链互不依赖——谁先发现新版本谁先亮。
 *
 * 检查节奏：挂载 + 窗口获焦 + 每 30 分钟一次；任何失败（后端未部署/网络）静默
 * 视为「没有新版本」，不打扰用户、不留错误 UI。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircleIcon } from "lucide-react";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { NimbusAppUpdateDialog } from "./NimbusAppUpdateDialog.js";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function NimbusUpdateBadge() {
  const { intl } = useZCodeIntl();
  const { appUpdateService } = useServices();
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const check = useCallback(() => {
    if (!appUpdateService) return;
    appUpdateService
      .checkForUpdate()
      .then((result) => {
        setAvailableVersion(result && result.updateAvailable ? result.latest.version : null);
      })
      .catch(() => {
        // 后端未部署该路由 / 网络抖动：静默按「无新版本」处理（下轮再探）。
      });
  }, [appUpdateService]);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [check]);

  if (!availableVersion) return null;

  return (
    <>
      <button
        type="button"
        data-testid="topbar-update-badge"
        title={intl.formatMessage({ id: "business.appUpdate.badgeTitle" }, { version: availableVersion })}
        aria-label={intl.formatMessage(
          { id: "business.appUpdate.badgeTitle" },
          { version: availableVersion },
        )}
        className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 text-ui-xs font-medium leading-none text-emerald-700 transition-colors select-none [app-region:no-drag] hover:border-emerald-500/40 hover:bg-emerald-500/15 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:border-emerald-500/45"
        onClick={() => setDialogOpen(true)}
      >
        <ArrowUpCircleIcon aria-hidden="true" className="size-3 shrink-0" />
        <span className="leading-none">{intl.formatMessage({ id: "business.appUpdate.badge" })}</span>
      </button>
      <NimbusAppUpdateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
