import { FolderOpen, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 启动门禁已通过但当前没有任何 workspace shell 时的兜底面。
 *
 * 旧实现在这个分支渲染 `null`：RootShell 只是一个 `h-dvh` 容器，于是整窗只剩背景色，
 * 用户看到的是全白/全灰的“白屏”，且没有任何可点入口，只能重启 App 才能恢复。
 * 关闭最后一个 workspace、或远程 workspace 因断连被移除，都会走到这里。
 *
 * 正常情况下 Root 的自动兜底会在用户看到这一屏之前就创建默认对话工作区；
 * 这一屏既是自动兜底失败时的出口，也是「不再出现死窗口」的保证。
 */
export function RootNoWorkspaceRecovery({
  busy = false,
  error,
  onOpenWorkspace,
  onCreateDefaultWorkspace,
}: {
  busy?: boolean;
  error?: string | null;
  onOpenWorkspace: () => void;
  onCreateDefaultWorkspace: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
            <TriangleAlert className="size-5 text-foreground-subtle" />
          </div>
          <div className="min-w-0">
            <h2 className="text-ui-lg font-medium text-foreground">
              {intl.formatMessage({ id: "root.noWorkspace.title" })}
            </h2>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "root.noWorkspace.description" })}
            </p>
            {error ? (
              <p className="mt-2 text-ui-sm text-destructive">
                {intl.formatMessage({ id: "root.noWorkspace.fallbackFailed" }, { message: error })}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={onOpenWorkspace} disabled={busy}>
            <FolderOpen className="size-4" />
            {intl.formatMessage({ id: "workspace.openWorkspace" })}
          </Button>
          <Button variant="secondary" onClick={onCreateDefaultWorkspace} disabled={busy}>
            <Plus className="size-4" />
            {intl.formatMessage({ id: "root.noWorkspace.createDefault" })}
          </Button>
          {busy ? (
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "common.loading" })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
