/**
 * 「可重置额度」弹窗：礼物徽章的点击落点（官方同款交互）。
 *
 * 结构对齐官方：三张额度卡（5 小时/周/基本额度）+ 每张可用重置卡一行
 * （窗口名 + 剩余张数 + 到期 + 绿色「重置」按钮）。「重置」真实调用
 * POST /reset-cards/{id}/redeem，成功后刷新额度状态并重拉清单。
 * 不可用的卡按钮置灰并展示原因（冷却中/达日限/无套餐）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuotaResetCard, QuotaStatusResult } from "@zcode/services";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { refreshNimbusAccountState } from "./nimbusAccountState.js";
import { toast } from "@/components/ui/toast.js";
import { NimbusQuotaSummary } from "./NimbusQuotaSummary.js";

type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;

const WINDOW_LABEL_ID: Record<string, string> = {
  "5h": "business.quota.window5hShort",
  week: "business.quota.windowWeeklyShort",
  period: "business.quota.validity",
  calls: "business.quota.remainingCalls",
};

export function NimbusResetCardsDialog({
  open,
  onClose,
  status,
  onManage,
}: {
  open: boolean;
  onClose: () => void;
  status: LoggedInStatus;
  /** 弹窗里的「更多」与卡片空态跳设置额度区（与面板同路）。 */
  onManage?: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [cards, setCards] = useState<readonly QuotaResetCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<number | null>(null);
  const [redeemedWindow, setRedeemedWindow] = useState<string | null>(null);
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  const loadCards = useCallback(async () => {
    setError(null);
    try {
      setCards(await providerQuotaService.listResetCards());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCards([]);
    }
  }, [providerQuotaService]);

  useEffect(() => {
    if (open) void loadCards();
  }, [open, loadCards]);

  const handleRedeem = useCallback(
    async (card: QuotaResetCard) => {
      setRedeemingId(card.id);
      setError(null);
      try {
        await providerQuotaService.redeemResetCard(card.id);
        setRedeemedWindow(card.window);
        // 成功要有明确反馈（用户实测：能重置但"该有的提示没有"）。
        toast(intl.formatMessage({ id: "business.quota.resetSuccess" }));
        // 重置即时改变额度/窗口口径：刷新共享快照并重拉清单。
        void refreshNimbusAccountState();
        await loadCards();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRedeemingId(null);
      }
    },
    [intl, providerQuotaService, loadCards],
  );

  const usable = (cards ?? []).filter((card) => !card.expired);
  const byWindow = (window: string) => usable.filter((card) => card.window === window);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-nimbus-reset-cards-dialog="">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "business.quota.resetCardsTitle" })}</DialogTitle>
        </DialogHeader>

        {/* 三张额度卡：与面板同源同构 */}
        <NimbusQuotaSummary status={status} compact onManage={onManage} />

        {/* 重置卡清单：按窗口分组，一行一卡 + 绿色重置按钮 */}
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {cards === null ? (
            <div className="flex h-16 items-center justify-center text-foreground-subtle">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : usable.length === 0 ? (
            <p className="py-4 text-center text-ui-sm text-foreground-subtle">
              {error ??
                intl.formatMessage({ id: "business.quota.resetCardsEmpty" })}
            </p>
          ) : (
            usable.map((card) => {
              const blocked = card.blockedReason.length > 0;
              const sameWindow = redeemedWindow === card.window;
              return (
                <div
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-surface px-4 py-3"
                  data-nimbus-reset-card-row=""
                  key={card.id}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-ui-sm font-medium text-foreground">
                        {intl.formatMessage({
                          id: WINDOW_LABEL_ID[card.window] ?? "business.quota.validity",
                        })}
                        {intl.formatMessage({ id: "business.quota.resetCardNoun" })}
                      </span>
                      <span className="shrink-0 rounded-md bg-emerald-500/20 px-2 py-0.5 text-ui-sm font-medium leading-none text-emerald-700 dark:text-emerald-300">
                        {intl.formatMessage(
                          { id: "business.quota.resetCardCount" },
                          { count: byWindow(card.window).length },
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-ui-xs text-foreground-subtle">
                      {blocked
                        ? card.blockedReason
                        : card.expiresAt > 0
                          ? intl.formatMessage(
                              { id: "business.quota.resetCardExpires" },
                              { date: dateFmt.format(card.expiresAt) },
                            )
                          : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={blocked || redeemingId !== null}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-ui-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void handleRedeem(card)}
                  >
                    {redeemingId === card.id ? (
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                    )}
                    {sameWindow && redeemingId === null
                      ? intl.formatMessage({ id: "business.quota.redeemed" })
                      : intl.formatMessage({ id: "business.quota.resetAction" })}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {error && usable.length > 0 ? (
          <p className="text-ui-sm text-warning">{error}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** 弹窗头部的关闭按钮由 DialogContent 自带；此处导出仅供测试桩使用。 */
export const ResetCardsDialogCloseIcon = X;
