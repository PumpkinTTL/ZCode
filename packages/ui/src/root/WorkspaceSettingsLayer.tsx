import { Suspense, lazy, useEffect } from "react";
import { ServiceProvider } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import type { WorkspaceSettingsLayerProps } from "@/root/types.js";

// Root.tsx 已把 SettingsPage lazy 化；本层若再静态 import 会形成第二条静态边，
// 把 settings 子树（recharts 图表链、pinyin-pro 插件搜索、usage-stats、Bots/WebRemoteControl
// 等）重新拖回首屏 preload 与首包内存。这里与 Root.tsx 保持同一 lazy 边界。
const SettingsPage = lazy(async () => ({
  default: (await import("@/SettingsPage.js")).SettingsPage,
}));

export function WorkspaceSettingsLayer({
  workspaceScopedServices,
  isDesktop,
  isMacDesktop,
  isWindowsDesktop,
  captionWorkspacePath,
  onBack,
  onCreateTask,
  onOpenWorkspace,
  allowOpenWorkspace,
  onLogin,
  user,
}: WorkspaceSettingsLayerProps) {
  useEffect(() => {
    logger.info("[Root] settings layer mounted");
    return () => {
      logger.info("[Root] settings layer unmounted");
    };
  }, []);

  return (
    <div className="absolute inset-0 z-10">
      <Suspense fallback={<div className="h-full w-full bg-background" />}>
        {workspaceScopedServices ? (
          <ServiceProvider services={workspaceScopedServices}>
            <SettingsPage
              isDesktop={isDesktop}
              isMacDesktop={isMacDesktop}
              isWindowsDesktop={isWindowsDesktop}
              captionWorkspacePath={captionWorkspacePath}
              onBack={onBack}
              onCreateTask={onCreateTask}
              onOpenWorkspace={onOpenWorkspace}
              allowOpenWorkspace={allowOpenWorkspace}
              onLogin={onLogin}
              user={user}
            />
          </ServiceProvider>
        ) : (
          <SettingsPage
            isDesktop={isDesktop}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
            captionWorkspacePath={captionWorkspacePath}
            onBack={onBack}
            onCreateTask={onCreateTask}
            onOpenWorkspace={onOpenWorkspace}
            allowOpenWorkspace={allowOpenWorkspace}
            onLogin={onLogin}
            user={user}
          />
        )}
      </Suspense>
    </div>
  );
}
