import type { QuotaModelDisplayTag } from "@zcode/services";
import type { NimbusModelDisplayMeta } from "@/lib/nimbusModelDisplayMeta.js";
import { cn } from "@/components/lib/utils.js";
import { useNimbusAccountState } from "@/business/quota/nimbusAccountState.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 官方模型展示徽标：组合标签（推荐/限时折扣/高峰定价）+ 计费倍率。
 * 纯展示，不参与任何选择/计费判定。
 *
 * 站长定稿（2026-10-10）：
 * - 登录态标签彩色区分（推荐=绿 / 限时折扣=蓝 / 高峰定价=琥珀），同色 hairline
 *   描边给 badge 实体感；未登录全部置灰，不加花活；
 * - 倍率是行末数字列：模型菜单里由调用方放在打勾前右对齐，settings 行内联在末尾；
 *   tabular-nums 裸数字、普通字重。
 *
 * 颜色走 styles.css 四主题块的 --color-model-tag-* 语义 token（文字），
 * 表面/描边由同一 token 现场低透明度派生，自动跟随明暗与 Zai 变体。
 */

const TAG_BADGE_BASE =
  "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-ui-xs font-medium leading-normal";

const TAG_ACCENT_CLASS: Record<QuotaModelDisplayTag, string> = {
  recommended:
    "text-[var(--color-model-tag-recommended)] bg-[color-mix(in_oklab,var(--color-model-tag-recommended)_16%,transparent)] border-[color-mix(in_oklab,var(--color-model-tag-recommended)_30%,transparent)]",
  limited_time:
    "text-[var(--color-model-tag-limited-time)] bg-[color-mix(in_oklab,var(--color-model-tag-limited-time)_16%,transparent)] border-[color-mix(in_oklab,var(--color-model-tag-limited-time)_30%,transparent)]",
  peak_pricing:
    "text-[var(--color-model-tag-peak)] bg-[color-mix(in_oklab,var(--color-model-tag-peak)_16%,transparent)] border-[color-mix(in_oklab,var(--color-model-tag-peak)_30%,transparent)]",
};

const TAG_GRAY_CLASS = "text-foreground-subtle bg-surface border-border/60";

const TAG_MESSAGE_IDS: Record<QuotaModelDisplayTag, string> = {
  recommended: "model.displayTag.recommended",
  limited_time: "model.displayTag.limitedTime",
  peak_pricing: "model.displayTag.peakPricing",
};

/** 0.5 → "0.5"；2 → "2"；0.666 → "0.67"（非法值不渲染，由服务端保证数值形状）。 */
function formatMultiplierValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** 组合标签（推荐/限时折扣/高峰定价 + 限时折扣活动文案）。 */
export function NimbusModelDisplayTags({ meta }: { meta: NimbusModelDisplayMeta }) {
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
  const badgeClass = (accent: string) =>
    cn(TAG_BADGE_BASE, loggedIn ? accent : TAG_GRAY_CLASS);
  return (
    <>
      {meta.tags.map((tag) => (
        <span key={tag} className={badgeClass(TAG_ACCENT_CLASS[tag])}>
          {intl.formatMessage({ id: TAG_MESSAGE_IDS[tag] })}
        </span>
      ))}
      {promo ? (
        <span
          className={badgeClass(TAG_ACCENT_CLASS.limited_time)}
          title={promoTitle || undefined}
        >
          {promo.label}
        </span>
      ) : null}
    </>
  );
}

/** 计费倍率：行末数字列。菜单里放打勾前右对齐；settings 行内联在徽标组之后。 */
export function NimbusModelDisplayMultiplier({ meta }: { meta: NimbusModelDisplayMeta }) {
  const { intl } = useZCodeIntl();
  if (meta.multiplier === null) return null;
  return (
    <span
      className="shrink-0 text-ui-xs tabular-nums text-foreground-subtle"
      title={intl.formatMessage({ id: "model.displayMeta.multiplierTitle" })}
    >
      {intl.formatMessage(
        { id: "model.displayMeta.multiplier" },
        { value: formatMultiplierValue(meta.multiplier) },
      )}
    </span>
  );
}

/** 组合形态：标签组 + 内联倍率（设置页模型行用；菜单侧两段分开摆位）。 */
export function NimbusModelDisplayBadges({ meta }: { meta: NimbusModelDisplayMeta }) {
  return (
    <>
      <NimbusModelDisplayTags meta={meta} />
      <NimbusModelDisplayMultiplier meta={meta} />
    </>
  );
}
