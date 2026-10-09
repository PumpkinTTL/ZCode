import type { QuotaModelDisplayTag } from "@zcode/services";
import type { NimbusModelDisplayMeta } from "@/lib/nimbusModelDisplayMeta.js";
import { cn } from "@/components/lib/utils.js";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 官方模型展示徽标组：组合标签（推荐/限时折扣/高峰定价）+ 计费倍率。
 * 纯展示，不参与任何选择/计费判定。
 *
 * 站长定稿（2026-10-10）：
 * - 登录态标签彩色区分（推荐=绿 / 限时折扣=琥珀 / 高峰定价=红），不要一片灰；
 * - 未登录全部置灰（锁定态本来就该素），不加花活；
 * - 倍率放最后、普通字重、不套胶囊——它是个数字不是个标签。
 */

const TAG_PILL_CLASS = "shrink-0 rounded-full px-1.5 py-px text-ui-xs leading-normal";

/** 登录态的标签彩色（语义 token，跟随明暗主题）。 */
const TAG_ACCENT_CLASS: Record<QuotaModelDisplayTag, string> = {
  recommended:
    "text-[var(--color-success)] bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)]",
  limited_time:
    "text-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]",
  peak_pricing:
    "text-[var(--color-destructive)] bg-[color-mix(in_oklab,var(--color-destructive)_12%,transparent)]",
};

const TAG_MESSAGE_IDS: Record<QuotaModelDisplayTag, string> = {
  recommended: "model.displayTag.recommended",
  limited_time: "model.displayTag.limitedTime",
  peak_pricing: "model.displayTag.peakPricing",
};

/** 0.5 → "0.5"；2 → "2"；0.666 → "0.67"（非法值不渲染，由服务端保证数值形状）。 */
function formatMultiplierValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function NimbusModelDisplayBadges({ meta }: { meta: NimbusModelDisplayMeta }) {
  const { intl } = useZCodeIntl();
  const { loggedIn } = useNimbusAccountState();
  const promo = meta.promo;
  const promoTitle = promo
    ? [promo.note, promo.endsAt]
        .filter((part): part is string | number => part !== null && part !== undefined && part !== "")
        .map((part) =>
          typeof part === "number"
            ? intl.formatMessage(
                { id: "model.displayPromo.endsAt" },
                { date: new Date(part).toLocaleDateString() },
              )
            : part,
        )
        .join(" · ")
    : undefined;
  return (
    <>
      {meta.tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            TAG_PILL_CLASS,
            loggedIn
              ? TAG_ACCENT_CLASS[tag]
              : "text-foreground-subtle bg-surface",
          )}
        >
          {intl.formatMessage({ id: TAG_MESSAGE_IDS[tag] })}
        </span>
      ))}
      {promo ? (
        <span
          className={cn(
            TAG_PILL_CLASS,
            loggedIn
              ? "text-[var(--color-warning)] bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]"
              : "text-foreground-subtle bg-surface",
          )}
          title={promoTitle || undefined}
        >
          {promo.label}
        </span>
      ) : null}
      {/* 倍率放最后：普通字重、不套胶囊——一个数字，不是一枚标签 */}
      {meta.multiplier !== null ? (
        <span
          className="shrink-0 text-ui-xs text-foreground-subtle"
          title={intl.formatMessage({ id: "model.displayMeta.multiplierTitle" })}
        >
          {intl.formatMessage(
            { id: "model.displayMeta.multiplier" },
            { value: formatMultiplierValue(meta.multiplier) },
          )}
        </span>
      ) : null}
    </>
  );
}
