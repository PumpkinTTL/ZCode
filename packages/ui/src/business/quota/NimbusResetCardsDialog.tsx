/**
 * 「可重置额度」弹窗：礼物徽章的点击落点（官方同款交互）。
 *
 * 结构对齐官方：三张额度卡（5 小时/周/基本额度）+ 重置卡按窗口合并成一行
 * （窗口名 + 总数徽章「N 张」+ 到期提示 + 绿色「重置」按钮）。「重置」真实调用
 * POST /reset-cards/{id}/redeem（自动核销该窗口最先到期的可用卡），
 * 成功后刷新额度状态并重拉清单。整组不可用则按钮置灰并展示原因（冷却中/达日限/无套餐）。
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
  // 按窗口合并成一行（用户反馈：一卡一行「几张几张」重复难看）——徽章给统计总数，
  // 重置按钮核销该窗口里最先到期的可用卡（先消耗临期卡，永久卡沉底）。
  const windowGroups = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, QuotaResetCard[]>();
    for (const card of usable) {
      if (!grouped.has(card.window)) {
        grouped.set(card.window, []);
        order.push(card.window);
      }
      grouped.get(card.window)!.push(card);
    }
    return order.map((window) => {
      const group = grouped.get(window)!;
      const redeemable = group
        .filter((card) => card.blockedReason.length === 0)
        .sort((a, b) => (a.expiresAt || Number.POSITIVE_INFINITY) - (b.expiresAt || Number.POSITIVE_INFINITY));
      const next = redeemable[0] ?? null;
      const first = group[0];
      if (!first) return { window, count: 0, redeemCard: null, note: null };
      return {
        window,
        count: group.length,
        redeemCard: next,
        note: next
          ? next.expiresAt > 0
            ? intl.formatMessage(
                { id: "business.quota.resetCardExpires" },
                { date: dateFmt.format(next.expiresAt) },
              )
            : null
          : first.blockedReason,
      };
    });
  }, [usable, intl, dateFmt]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-nimbus-reset-cards-dialog="">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "business.quota.resetCardsTitle" })}</DialogTitle>
        </DialogHeader>

        {/* 三张额度卡：与面板同源同构 */}
        <NimbusQuotaSummary status={status} compact onManage={onManage} />

        {/* 重置卡清单：按窗口合并，一行 = 窗口名 + 总数徽章 + 重置按钮 */}
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
            windowGroups.map(({ window, count, redeemCard, note }) => {
              const sameWindow = redeemedWindow === window;
              const busy = redeemCard !== null && redeemingId === redeemCard.id;
              return (
                <div
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-surface px-4 py-3"
                  data-nimbus-reset-card-row=""
                  key={window}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-ui-sm font-medium text-foreground">
                        {intl.formatMessage({
                          id: WINDOW_LABEL_ID[window] ?? "business.quota.validity",
                        })}
                        {intl.formatMessage({ id: "business.quota.resetCardNoun" })}
                      </span>
                      <span className="shrink-0 rounded-md bg-emerald-500/20 px-2 py-0.5 text-ui-sm font-medium leading-none text-emerald-700 dark:text-emerald-300">
                        {intl.formatMessage(
                          { id: "business.quota.resetCardCount" },
                          { count },
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-ui-xs text-foreground-subtle">
                      {note}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={redeemCard === null || redeemingId !== null}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-ui-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => redeemCard && void handleRedeem(redeemCard)}
                  >
                    {busy ? (
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
