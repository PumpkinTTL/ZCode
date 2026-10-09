import type { QuotaModelDisplayTag } from "@zcode/services";
import type { NimbusModelDisplayMeta } from "@/lib/nimbusModelDisplayMeta.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 官方模型展示徽标组：计费倍率（如 0.5×）、限时折扣标签（服务端已判定生效）、
 * 组合标签（推荐/限时折扣/高峰定价）。纯展示，不参与任何选择/计费判定。
 *
 * 样式与 ModelConfigSelect 的 badgeLabel 胶囊同族（bg-surface 小胶囊），
 * 折扣标签用 warning 色突出；模型选择器与设置页模型行共用本组件。
 */

const DISPLAY_BADGE_CLASS_NAME =
  "shrink-0 rounded-full bg-surface px-1 py-px text-ui-xs font-medium leading-normal text-foreground-subtle";

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
  const { intl, locale } = useZCodeIntl();
  const promo = meta.promo;
  const promoTitle = promo
    ? [promo.note, promo.endsAt]
        .filter((part): part is string | number => part !== null && part !== undefined && part !== "")
        .map((part) =>
          typeof part === "number"
            ? intl.formatMessage(
                { id: "model.displayPromo.endsAt" },
                { date: new Date(part).toLocaleDateString(locale) },
              )
            : part,
        )
        .join(" · ")
    : undefined;
  return (
    <>
      {meta.multiplier !== null ? (
        <span
          className={DISPLAY_BADGE_CLASS_NAME}
          title={intl.formatMessage({ id: "model.displayMeta.multiplierTitle" })}
        >
          {intl.formatMessage(
            { id: "model.displayMeta.multiplier" },
            { value: formatMultiplierValue(meta.multiplier) },
          )}
        </span>
      ) : null}
      {promo ? (
        <span
          className={`${DISPLAY_BADGE_CLASS_NAME} text-[var(--color-warning)]`}
          title={promoTitle || undefined}
        >
          {promo.label}
        </span>
      ) : null}
      {meta.tags.map((tag) => (
        <span key={tag} className={DISPLAY_BADGE_CLASS_NAME}>
          {intl.formatMessage({ id: TAG_MESSAGE_IDS[tag] })}
        </span>
      ))}
    </>
  );
}
