/**
 * 每日签到卡（GET/POST /api/v1/user/checkin[/status]，JWT 鉴权）。
 *
 * 只在「我的额度」已登录面板渲染：展示连签天数与今日是否已签；未签时「签到」
 * 按钮触发 POST，成功 toast 本次奖励（裸数字）并刷新共享额度快照（钱包余额
 * 立刻跟上）；失败（重复签到 409 / 未绑定邮箱 403 等）直接 toast 后端 detail。
 * 功能关闭（后端 403「签到未开启」）或状态查询失败时整卡不渲染——纯增益卡片，
 * 不因签到服务的任何异常打崩额度页。
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarCheckIcon, Loader2Icon } from "lucide-react";
import type { QuotaCheckinStatus } from "@zcode/services";
import { toast } from "@/components/ui/toast.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { refreshNimbusAccountState } from "./nimbusAccountState.js";

export function NimbusCheckinCard() {
  const { intl } = useZCodeIntl();
  const { providerQuotaService } = useServices();
  const [status, setStatus] = useState<QuotaCheckinStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    providerQuotaService
      .getCheckinStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((error) => {
        // 功能关闭（403 签到未开启）/ token 失效 / 网络抖动：整卡不渲染，留日志。
        logger.warn("[quota] 签到状态查询失败，签到卡不展示", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [providerQuotaService]);

  const handleCheckin = useCallback(async () => {
    setSubmitting(true);
    try {
      const result = await providerQuotaService.checkin();
      // 乐观收敛为已签：POST 回执的 streak/tomorrow 与 status 同口径，直接落本地。
      setStatus((current) =>
        current
          ? {
              ...current,
              checkedInToday: true,
              streak: result.streak,
              tomorrowCredits: result.tomorrowCredits,
            }
          : current,
      );
      // 奖励是裸数字（无千分位），文案里只做数字插值。
      toast(intl.formatMessage({ id: "business.quota.checkinSuccess" }, { credits: result.credits }));
      // 奖励入账的是钱包余额，共享快照刷新让账户卡的余额立刻跟上。
      void refreshNimbusAccountState();
    } catch (error) {
      // 失败文案直接展示后端 detail（如「今日已签到」「请先绑定邮箱」）。
      toast(error instanceof Error ? error.message : String(error), { variant: "warning" });
    } finally {
      setSubmitting(false);
    }
  }, [intl, providerQuotaService]);

  if (!status) return null;

  const checked = status.checkedInToday;
  const segments = [
    status.streak > 0
      ? intl.formatMessage({ id: "business.quota.checkinStreakDays" }, { days: status.streak })
      : "",
    checked
      ? intl.formatMessage(
          { id: "business.quota.checkinRewardTomorrow" },
          { credits: status.tomorrowCredits },
        )
      : intl.formatMessage(
          { id: "business.quota.checkinRewardToday" },
          { credits: status.tomorrowCredits },
        ),
  ].filter(Boolean);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-xs"
      data-quota-checkin=""
    >
      <div className="min-w-0">
        <h4 className="text-ui-sm font-semibold text-foreground">
          {intl.formatMessage({ id: "business.quota.checkinTitle" })}
        </h4>
        <p className="mt-1 text-ui-xs text-foreground-subtle">{segments.join(" · ")}</p>
      </div>
      {checked ? (
        <Button type="button" variant="outline" size="sm" disabled className="cursor-default">
          <CalendarCheckIcon className="size-3.5 mr-1" />
          {intl.formatMessage({ id: "business.quota.checkinDone" })}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          className="cursor-pointer"
          disabled={submitting}
          onClick={() => void handleCheckin()}
        >
          {submitting ? <Loader2Icon className="size-3.5 mr-1 animate-spin" /> : null}
          {intl.formatMessage({ id: "business.quota.checkinAction" })}
        </Button>
      )}
    </div>
  );
}
