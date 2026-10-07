/**
 * 「更新日志」弹窗（Polaris 自有业务）：更新检查 + 版本目录投影。
 *
 * 数据来自 IAppUpdateService（cbcn-cloud app_release.py 契约，公开端点，无需登录）：
 *  - checkForUpdate()：null = 暂无发布版本（404 口径，非错误）；
 *  - listReleases()：已发布版本目录（更新日志正文 + 是否仍有安装包）；
 * 下载走预签名/直链（core/app_release.py:144，预签名默认 1 小时有效）——
 * 点击即用系统浏览器打开，不长期缓存该链接。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppReleaseHistoryEntry, AppUpdateCheckResult } from "@zcode/services";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function NimbusAppUpdateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { intl, locale } = useZCodeIntl();
  const { appUpdateService } = useServices();
  const platform = usePlatform();
  const [check, setCheck] = useState<AppUpdateCheckResult | null>(null);
  const [releases, setReleases] = useState<readonly AppReleaseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  const load = useCallback(async () => {
    if (!appUpdateService) return;
    setLoading(true);
    setError(null);
    try {
      const [nextCheck, nextReleases] = await Promise.all([
        appUpdateService.checkForUpdate(),
        appUpdateService.listReleases(20),
      ]);
      setCheck(nextCheck);
      setReleases(nextReleases);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [appUpdateService]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 服务未装配（旧 host）时不给入口语义：直接不渲染内容，避免空白弹窗。
  const unavailable = !appUpdateService;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-nimbus-app-update-dialog="">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "business.appUpdate.title" })}</DialogTitle>
        </DialogHeader>

        {/* 状态行：检查结果 / 下载入口 */}
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-ui-sm text-foreground">
            {unavailable
              ? intl.formatMessage({ id: "business.appUpdate.unavailable" })
              : loading
                ? intl.formatMessage({ id: "business.appUpdate.loading" })
                : error
                  ? intl.formatMessage({ id: "business.appUpdate.checkFailed" })
                  : check === null
                    ? intl.formatMessage({ id: "business.appUpdate.noReleases" })
                    : check.updateAvailable
                      ? intl.formatMessage(
                          { id: "business.appUpdate.newVersion" },
                          { version: check.latest.version },
                        )
                      : intl.formatMessage({ id: "business.appUpdate.upToDate" })}
          </span>
          {check?.updateAvailable && check.latest.file.url ? (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => platform.openExternal(check.latest.file.url)}
            >
              <Download aria-hidden="true" className="size-3.5" />
              {intl.formatMessage({ id: "business.appUpdate.download" })}
            </Button>
          ) : null}
        </div>

        {/* 版本目录：更新日志正文 */}
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {loading && releases.length === 0 ? (
            <div className="flex h-16 items-center justify-center text-foreground-subtle">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : releases.length === 0 && !error && !unavailable ? (
            <p className="py-4 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "business.appUpdate.noReleases" })}
            </p>
          ) : (
            releases.map((release) => (
              <div
                className="rounded-lg border border-border p-3"
                data-app-release-entry=""
                key={`${release.channel}:${release.platform}:${release.version}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-ui-base font-medium text-foreground">
                    v{release.version}
                  </span>
                  {release.forced ? (
                    <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-destructive">
                      {intl.formatMessage({ id: "business.appUpdate.forced" })}
                    </span>
                  ) : null}
                  {!release.hasFile ? (
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium leading-none text-foreground-subtle">
                      {intl.formatMessage({ id: "business.appUpdate.delisted" })}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-ui-sm tabular-nums text-foreground-subtle">
                    {release.publishedAt > 0 ? dateFmt.format(release.publishedAt) : ""}
                  </span>
                </div>
                {release.notes ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-ui-sm text-foreground-subtle">
                    {release.notes}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
