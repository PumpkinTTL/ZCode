/**
 * 钱包充值弹窗（Polaris 自有业务）：「我的额度」钱包余额卡充值入口的落点。
 *
 * 闭环：选/输金额（10-2000 元，后端硬限）→ 创建支付宝当面付订单 → 用系统外链
 * 打开支付页（qr_code，桌面端唤起支付宝）→ 3 秒轮询订单状态（后端对同一订单
 * 有 3 秒节流键，正好贴住；pending 单 15 分钟后由后端自动终态化）→ 支付成功
 * toast + 刷新共享额度快照；等待中可取消订单（关支付宝交易 + 关本地单）。
 *
 * 金额一律裸数字展示（不加千分位逗号，与额度面板 formatInt 同口径）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuotaRechargeOrderCreated } from "@zcode/services";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { refreshNimbusAccountState } from "./nimbusAccountState.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";

/** 预设面额（元）：与门户充值页同档；自定义金额范围由后端硬限 10-2000。 */
const AMOUNT_PRESETS = [10, 30, 50, 100, 200, 500] as const;
const AMOUNT_MIN = 10;
const AMOUNT_MAX = 2000;
/** 轮询间隔：后端 GET /alipay/orders/{order_no} 对同一订单有 3 秒节流键。 */
const POLL_INTERVAL_MS = 3000;

type RechargePhase = "form" | "waiting" | "paid" | "closed";

export function NimbusRechargeDialog({
  open,
  onClose,
  creditsPerYuan,
}: {
  open: boolean;
  onClose: () => void;
  /** 1 元 = N 积分（后台实时配置，随 /user/me 下发；0 = 未知不展示预估） */
  creditsPerYuan: number;
}) {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const platform = usePlatform();

  const [phase, setPhase] = useState<RechargePhase>("form");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(50);
  const [customAmount, setCustomAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<QuotaRechargeOrderCreated | null>(null);
  const [paidCredits, setPaidCredits] = useState(0);
  /** 轮询循环的活性句柄：phase 变化/弹窗关闭时由 cleanup 停表。 */
  const pollTimerRef = useRef<number | null>(null);

  // 每次打开重置回表单态（等待中的订单留在服务端，15 分钟后端自动关闭）。
  useEffect(() => {
    if (open) {
      setPhase("form");
      setError(null);
      setOrder(null);
    }
  }, [open]);

  // 卸载/关闭时停轮询（等待中的订单由服务端超时清扫兜底，不本地取消）。
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const currentAmount = useMemo(() => {
    const custom = Number(customAmount);
    if (customAmount.trim() !== "" && Number.isFinite(custom) && custom > 0) return custom;
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  const amountError = useMemo(() => {
    if (currentAmount === null) return null;
    if (currentAmount < AMOUNT_MIN) return intl.formatMessage({ id: "business.quota.rechargeErrMin" });
    if (currentAmount > AMOUNT_MAX) return intl.formatMessage({ id: "business.quota.rechargeErrMax" });
    return null;
  }, [currentAmount, intl]);

  const estimatedCredits =
    currentAmount !== null && creditsPerYuan > 0 ? Math.round(currentAmount * creditsPerYuan) : null;

  /** 用系统外链打开支付宝支付页（qr_code 为 https 链接，浏览器侧唤起支付宝）。 */
  const openPaymentPage = useCallback(
    (payUrl: string) => {
      try {
        platform.openExternal(payUrl);
      } catch (openError) {
        logger.warn("[NimbusRecharge] 打开支付宝支付页失败", {
          error: openError instanceof Error ? openError.message : String(openError),
        });
        setError(intl.formatMessage({ id: "business.quota.rechargeOpenFailed" }));
      }
    },
    [platform, intl],
  );

  /** 轮询订单状态：paid → toast + 刷新共享快照；closed → 终态展示。 */
  const startPolling = useCallback(
    (orderNo: string) => {
      if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = window.setInterval(() => {
        void providerQuotaService
          .getRechargeOrder(orderNo)
          .then((status) => {
            if (status.status === "paid") {
              if (pollTimerRef.current !== null) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              setPaidCredits(status.credits);
              setPhase("paid");
              toast(intl.formatMessage({ id: "business.quota.rechargePaidTitle" }));
              // 余额/套餐变化广播到所有订阅面（侧边栏/设置页/弹窗共用同一快照）。
              void refreshNimbusAccountState({ bustInFlight: true });
            } else if (status.status === "closed") {
              if (pollTimerRef.current !== null) {
                window.clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              setPhase("closed");
            }
            // pending：继续轮询；单次查询失败（网络抖动）静默等下一轮。
          })
          .catch(() => {
            /* 查询单次失败不终止轮询：后端 3s 节流/网络抖动都会自愈 */
          });
      }, POLL_INTERVAL_MS);
    },
    [providerQuotaService, intl],
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleCreateOrder = useCallback(async () => {
    if (currentAmount === null || amountError !== null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await providerQuotaService.createRechargeOrder(currentAmount);
      setOrder(created);
      setPhase("waiting");
      openPaymentPage(created.qrCode);
      startPolling(created.orderNo);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }, [currentAmount, amountError, busy, providerQuotaService, openPaymentPage, startPolling]);

  const handleCancelOrder = useCallback(async () => {
    if (!order || busy) return;
    setBusy(true);
    setError(null);
    try {
      await providerQuotaService.cancelRechargeOrder(order.orderNo);
      stopPolling();
      toast(intl.formatMessage({ id: "business.quota.rechargeCancelled" }));
      setPhase("form");
      setOrder(null);
    } catch (cancelError) {
      // 已支付/已关闭的单不可取消（400）：拉一次状态让界面落到真实终态。
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setBusy(false);
    }
  }, [order, busy, providerQuotaService, stopPolling, intl]);

  const handleClose = useCallback(() => {
    if (phase === "waiting") stopPolling();
    onClose();
  }, [phase, stopPolling, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : handleClose())}>
      <DialogContent className="max-w-md" data-nimbus-recharge-dialog="">
        <DialogHeader>
          <DialogTitle className="text-ui-base font-semibold">
            {intl.formatMessage({ id: "business.quota.rechargeTitle" })}
          </DialogTitle>
          <DialogDescription className="text-ui-sm text-foreground-subtle">
            {phase === "form"
              ? intl.formatMessage({ id: "business.quota.rechargeDescription" })
              : null}
          </DialogDescription>
        </DialogHeader>

        {phase === "form" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {AMOUNT_PRESETS.map((amount) => {
                const selected = customAmount.trim() === "" && selectedPreset === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    className={
                      "rounded-lg border px-2 py-2.5 text-ui-base tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 " +
                      (selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:border-border-hover hover:bg-hover")
                    }
                    disabled={busy}
                    onClick={() => {
                      setSelectedPreset(amount);
                      setCustomAmount("");
                      setError(null);
                    }}
                  >
                    ¥{amount}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nimbus-recharge-custom" className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "business.quota.rechargeCustom" })}
              </Label>
              <Input
                id="nimbus-recharge-custom"
                className="h-9 text-ui-base tabular-nums"
                inputMode="decimal"
                value={customAmount}
                placeholder={intl.formatMessage({ id: "business.quota.rechargeCustomPlaceholder" })}
                disabled={busy}
                onChange={(event) => {
                  setCustomAmount(event.target.value);
                  setError(null);
                }}
              />
              {amountError !== null ? (
                <p className="text-ui-xs text-warning">{amountError}</p>
              ) : estimatedCredits !== null ? (
                <p className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "business.quota.rechargeEstimate" },
                    { credits: String(Math.round(estimatedCredits)) },
                  )}
                </p>
              ) : null}
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="button"
              className="h-9 w-full rounded-lg text-ui-base"
              disabled={currentAmount === null || amountError !== null || busy}
              onClick={() => void handleCreateOrder()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              {intl.formatMessage({ id: "business.quota.rechargePay" })}
            </Button>
          </div>
        ) : phase === "waiting" && order ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-surface px-4 py-5">
              <Loader2 className="size-5 animate-spin text-foreground-subtle" />
              <span className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "business.quota.rechargeWaiting" })}
              </span>
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                ¥{order.payAmount}
              </span>
              <span className="text-ui-xs text-foreground-subtle tabular-nums">
                {intl.formatMessage({ id: "business.quota.rechargeOrderNo" })} {order.orderNo}
              </span>
            </div>
            <p className="text-ui-sm/relaxed text-foreground-subtle">
              {intl.formatMessage({ id: "business.quota.rechargeWaitingHint" })}
            </p>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full rounded-lg text-ui-sm"
                disabled={busy}
                onClick={() => openPaymentPage(order.qrCode)}
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                {intl.formatMessage({ id: "business.quota.rechargeReopen" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full rounded-lg text-ui-sm text-foreground-subtle hover:text-foreground"
                disabled={busy}
                onClick={() => void handleCancelOrder()}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                {intl.formatMessage({ id: "business.quota.rechargeCancelOrder" })}
              </Button>
            </div>
          </div>
        ) : phase === "paid" ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "business.quota.rechargePaidTitle" })}
            </span>
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage(
                { id: "business.quota.rechargePaidHint" },
                { credits: String(Math.round(paidCredits)) },
              )}
            </span>
            <Button
              type="button"
              className="mt-2 h-9 w-full rounded-lg text-ui-base"
              onClick={onClose}
            >
              {intl.formatMessage({ id: "business.quota.rechargeDone" })}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4">
            <XCircle className="size-8 text-foreground-subtlest" aria-hidden="true" />
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "business.quota.rechargeClosed" })}
            </span>
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-9 w-full rounded-lg text-ui-sm"
              onClick={() => {
                setPhase("form");
                setOrder(null);
                setError(null);
              }}
            >
              {intl.formatMessage({ id: "business.quota.rechargeRetry" })}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
