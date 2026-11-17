import { Loader2Icon } from "lucide-react";

/** Model Provider 详情的加载占位。原 Coding Plan 状态卡片组已随官方账号业务移除。 */
export function ModelProviderLoadingCard({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-ui-base text-foreground-subtle">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{loadingLabel}</span>
      </div>
    </div>
  );
}
