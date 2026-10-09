/**
 * 「可重置额度」弹窗：礼物徽章的点击落点（官方同款交互）。
 *
 * 结构对齐官方：三张额度卡（5 小时/周/基本额度）+ 重置卡按窗口分组（窗口名与
 * 「N 张」总数只在组头出现一次），组内一卡一行：各自的过期时间 + 各自的绿色
 * 「重置」按钮（用户自选核销哪张）。「重置」真实调用 POST /reset-cards/{id}/redeem，
 * 成功后刷新额度状态并重拉清单。单卡不可用则该行按钮置灰并展示原因（冷却中/达日限/无套餐）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuotaResetCard, QuotaStatusResult } from "@zcode/services";
import { Loader2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { refreshNimbusAccountState } from "./nimbusAccountState.js";
import { toast } from "@/components/ui/toast.js";
import { NimbusQuotaSummary } from "./NimbusQuotaSummary.js";

type LoggedInStatus = Extract<QuotaStatusResult, { loggedIn: true }>;

const WINDOW_LABEL_ID: Record<string, string> = {
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

  const formatWindowResetTitle = (win: string) => {
    if (win === "5h") {
      return intl.formatMessage({ id: "business.quota.window5hResetTitle" });
    }
    if (win === "week") {
      return intl.formatMessage({ id: "business.quota.windowWeeklyResetTitle" });
    }
    const label = intl.formatMessage({
      id: WINDOW_LABEL_ID[win] ?? "business.quota.validity",
    });
    return `${label} ${intl.formatMessage({ id: "business.quota.resetCardNoun" })}`;
  };

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
        void refreshNimbusAccountState({ bustInFlight: true });
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
  // 每张卡都是独立的、各有自己的过期时间：按窗口分组展示（1 行 1 窗口），
  // 组内展示窗口标题、翡翠数量胶囊与最早到期时间，优先核销最早到期的卡。
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
    return order.map((window) => ({ window, cards: grouped.get(window) ?? [] }));
  }, [usable]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg" data-nimbus-reset-cards-dialog="">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "business.quota.resetCardsTitle" })}</DialogTitle>
        </DialogHeader>

        {/* 三张额度卡：与面板同源同构 */}
        <NimbusQuotaSummary status={status} compact onManage={onManage} />

        {/* 重置卡清单：按窗口收敛为精致企业级卡片，展示标题、翡翠数量胶囊、到期提醒与重置操作 */}
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
            windowGroups.map(({ window, cards: groupCards }) => {
              // 每张卡独立成行（用户要求）：窗口名与总数只在组头出现一次，
              // 组内一卡一行——各自的过期时间 + 各自的重置按钮，用户自选核销哪张。
              // 组内按到期时间排序（临期在前，永久沉底），方便对照挑选。
              const ordered = groupCards
                .slice()
                .sort((a, b) => {
                  if (a.expiresAt > 0 && b.expiresAt > 0) return a.expiresAt - b.expiresAt;
                  if (a.expiresAt > 0) return -1;
                  if (b.expiresAt > 0) return 1;
                  return 0;
                });
              return (
                <div
                  className="rounded-xl border border-border/70 bg-card"
                  data-nimbus-reset-card-row=""
                  key={window}
                >
                  <div className="flex items-center justify-between gap-4 px-3.5 pb-1 pt-3">
                    <span className="truncate text-ui-sm font-medium text-foreground">
                      {formatWindowResetTitle(window)}
                    </span>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-ui-xs font-medium leading-none text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {intl.formatMessage(
                        { id: "business.quota.resetCardCount" },
                        { count: groupCards.length },
                      )}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {ordered.map((card) => {
                      const blocked = card.blockedReason.length > 0;
                      const busy = redeemingId === card.id;
                      const redeemed = redeemedWindow === window && redeemingId === null;
                      return (
                        <div
                          className="flex items-center justify-between gap-3 px-3.5 py-2"
                          key={card.id}
                        >
                          <span
                            className={
                              blocked
                                ? "min-w-0 truncate text-ui-xs text-warning"
                                : "min-w-0 truncate text-ui-xs text-foreground-subtle"
                            }
                          >
                            {blocked
                              ? card.blockedReason
                              : card.expiresAt > 0
                                ? intl.formatMessage(
                                    { id: "business.quota.resetCardExpires" },
                                    { date: dateFmt.format(card.expiresAt) },
                                  )
                                : intl.formatMessage({
                                    id: "business.quota.resetCardNeverExpires",
                                  })}
                          </span>
                          <button
                            type="button"
                            disabled={blocked || redeemingId !== null}
                            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-ui-xs font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer select-none"
                            onClick={() => void handleRedeem(card)}
                          >
                            {busy ? (
                              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                            ) : (
                              <RotateCcw aria-hidden="true" className="size-3.5" />
                            )}
                            {redeemed && !blocked
                              ? intl.formatMessage({ id: "business.quota.redeemed" })
                              : intl.formatMessage({ id: "business.quota.resetAction" })}
                          </button>
                        </div>
                      );
                    })}
                  </div>
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

