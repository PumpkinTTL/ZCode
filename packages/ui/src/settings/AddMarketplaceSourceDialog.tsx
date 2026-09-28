import { useRef, useState, type DragEvent } from "react";
import { FolderOpen, Loader2, Plus } from "lucide-react";
import {
  isPresetMarketplaceAdded,
  type PresetPluginMarketplace,
  type ZCodePluginMarketplaceSummary,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";

/**
 * 顶栏 New 直接打开添加市场源对话框：收编原 AddMarketplacePopover 的
 * github/git/URL/本地路径（含拖放与目录选择）能力，零后端新增。
 */
export function AddMarketplaceSourceDialog({
  open,
  onOpenChange,
  onAddMarketplace,
  operationId,
  error,
  presets = [],
  marketplaces = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMarketplace: (source: string) => Promise<boolean>;
  operationId: string | null;
  error?: string | null;
  /** 可一键添加的公开市场源（已添加的会被过滤掉）。 */
  presets?: readonly PresetPluginMarketplace[];
  /** 当前已登记市场，用于判断哪些预置源已添加。 */
  marketplaces?: readonly ZCodePluginMarketplaceSummary[];
}) {
  const { intl } = useZCodeIntl();
  const platform = useOptionalPlatform();
  // 仅桌面端能把拖拽 File / 目录选择框解析成 agent 可访问的本地绝对路径；Web 端隐藏这些入口。
  const canPickPath = platform?.canSelectFilePath ?? false;
  const [source, setSource] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const trimmedSource = source.trim();
  const adding = operationId === `marketplace:add:${trimmedSource}`;
  // 本地输入法 composition 态：部分平台 isComposing 会提前翻 false，靠 ref 兜底，避免候选确认误触发添加。
  const compositionActiveRef = useRef(false);
  // 防重复提交：Enter 与点击共用，避免 store 回写前的窗口里重复发起同一来源的添加。
  const pendingRef = useRef(false);

  const handleAdd = async () => {
    if (trimmedSource.length === 0 || pendingRef.current) return;
    pendingRef.current = true;
    try {
      const added = await onAddMarketplace(trimmedSource);
      // 失败时保留输入与弹层，让用户结合上方错误提示修正来源后重试。
      if (added) {
        setSource("");
        onOpenChange(false);
      }
    } finally {
      pendingRef.current = false;
    }
  };

  // 预置源一键添加：与手动输入共用同一防重提交闸门，成功即关闭弹层。
  const handleAddPreset = async (preset: PresetPluginMarketplace) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      const added = await onAddMarketplace(preset.source);
      if (added) onOpenChange(false);
    } finally {
      pendingRef.current = false;
    }
  };

  const availablePresets = presets.filter(
    (preset) => !isPresetMarketplaceAdded(preset, marketplaces),
  );

  const handleChooseDirectory = async () => {
    if (!platform) return;
    try {
      const dir = await platform.selectDirectory();
      if (dir) setSource(dir);
    } catch {
      // 取消或对话框异常时静默：保留当前输入，不打断添加流程。
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const path = platform?.getPathForFile?.(file)?.trim();
    if (path) setSource(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="plugin-store-add-source-dialog"
        className={cn(
          "w-[min(420px,calc(100vw-2rem))] max-w-none transition-colors",
          canPickPath && dragActive ? "border-border-hover bg-surface-hover" : "",
        )}
        onDragOver={
          canPickPath
            ? (event) => {
                event.preventDefault();
                setDragActive(true);
              }
            : undefined
        }
        onDragLeave={
          canPickPath
            ? (event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragActive(false);
                }
              }
            : undefined
        }
        onDrop={canPickPath ? handleDrop : undefined}
      >
        <DialogTitle className="text-ui-lg font-medium text-foreground">
          {intl.formatMessage({ id: "settings.plugins.marketplaces.add" })}
        </DialogTitle>
        {error ? (
          <div
            className="max-h-[min(240px,40vh)] min-w-0 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-base whitespace-pre-wrap break-words text-destructive"
            data-testid="plugin-store-add-source-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {availablePresets.length > 0 ? (
          // min-w-0 是关键：DialogContent 是 grid，列是 auto 轨道。
          // 不加的话，本区块的最小内容宽度（truncate 的 nowrap 文案）会把整条轨道顶宽，
          // 连输入框和页脚按钮一起溢出到面板右侧。
          <div className="min-w-0 space-y-1">
            <div className="px-1 text-ui-xs font-medium text-foreground-subtle">
              {intl.formatMessage({ id: "settings.plugins.marketplaces.presets.title" })}
            </div>
            <div className="max-h-[min(220px,32vh)] min-w-0 space-y-1 overflow-x-hidden overflow-y-auto">
              {availablePresets.map((preset) => {
                const adding = operationId === `marketplace:add:${preset.source}`;
                return (
                  <div
                    key={preset.id}
                    data-testid="plugin-store-preset-source"
                    data-preset-id={preset.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui-base font-medium text-foreground">
                        {preset.name}
                      </div>
                      <div className="truncate text-ui-xs text-foreground-subtle">
                        {preset.description}
                      </div>
                    </div>
                    <Button
                      type="button"
                      data-testid="plugin-store-preset-add"
                      data-preset-id={preset.id}
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={adding}
                      onClick={() => void handleAddPreset(preset)}
                    >
                      {adding ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus data-icon="inline-start" aria-hidden="true" />
                      )}
                      {intl.formatMessage({ id: "settings.plugins.marketplaces.presets.add" })}
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="px-1 pt-1 text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "settings.plugins.marketplaces.presets.customLabel" })}
            </div>
          </div>
        ) : null}
        <Input
          type="text"
          data-testid="plugin-store-add-source-input"
          size="lg"
          autoFocus
          aria-label={intl.formatMessage({ id: "settings.plugins.marketplaces.source" })}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onCompositionStart={() => {
            compositionActiveRef.current = true;
          }}
          onCompositionEnd={() => {
            compositionActiveRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (
              isImeComposingKeyEvent({
                compositionActive: compositionActiveRef.current,
                nativeEvent: event.nativeEvent,
              })
            ) {
              return;
            }
            event.preventDefault();
            void handleAdd();
          }}
          placeholder={intl.formatMessage({ id: "settings.plugins.marketplaces.source" })}
        />
        {canPickPath ? (
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.plugins.marketplaces.dropHint" })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {canPickPath ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void handleChooseDirectory()}
            >
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.plugins.marketplaces.chooseDirectory" })}
            </Button>
          ) : null}
          <Button
            type="button"
            data-testid="plugin-store-add-source-submit"
            variant="default"
            size="lg"
            disabled={trimmedSource.length === 0 || adding}
            onClick={() => void handleAdd()}
          >
            {adding ? (
              <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus data-icon="inline-start" aria-hidden="true" />
            )}
            {intl.formatMessage({ id: "settings.plugins.marketplaces.add" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
