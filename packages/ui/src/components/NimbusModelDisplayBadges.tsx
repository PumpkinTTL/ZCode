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
 * 站长令（2026-10-10 追补）：自定义标签文案命中「官方」关键词 → 复用「限时折扣」
 * 蓝（同一 token、同一软底形态）；未命中维持中性灰。判定见 isOfficialKeywordLabel。
 *
 * 颜色走 styles.css 四主题块的 --color-model-tag-* 语义 token（文字），
 * 表面/描边由同一 token 现场低透明度派生，自动跟随明暗与 Zai 变体。
 */

// 统一模型微徽章规范：精巧圆角矩形（rounded-md）、细微描边、合宜内边距与高度（h-5 px-1.5）、
// 精确居中对齐，与模型菜单项整体设计语言严密贴合。
const TAG_BADGE_BASE =
  "inline-flex shrink-0 items-center justify-center rounded-md border px-1.5 h-5 text-ui-xs font-medium leading-none select-none";

const TAG_ACCENT_CLASS: Record<QuotaModelDisplayTag, string> = {
  recommended:
    "text-[#345e3d] bg-[#eef5ef] border-[#b8d5be] dark:text-[#8ec69b] dark:bg-[#8ec69b]/12 dark:border-[#8ec69b]/25",
  limited_time:
    "text-blue-600 bg-blue-500/10 border-blue-500/20 dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20",
  peak_pricing:
    "text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20",
};

const TAG_GRAY_CLASS = "text-foreground-subtle bg-surface/70 border-border/70";

/**
 * 归一规则：命中「官方」关键词的标签复用的蓝色 accent——即「限时折扣」的同一
 * token 与软底形态（文字色用同一 token + 10% color-mix 背景）。模型菜单组头
 * labelTag（ModelConfigSelect）与行内自定义标签共用，保证两处是同一只蓝。
 */
export const OFFICIAL_KEYWORD_ACCENT_CLASS = TAG_ACCENT_CLASS.limited_time;

/**
 * 自定义标签关键词判定（产品语义：管理端配置的运营标签按文案着色，判定只认
 * 文案子串、不认来源/分组类型）。当前关键词：「官方」——「官方合作」「官方直连」
 * 「官方认证」等均可命中，表达官方背书，复用「限时折扣」蓝；未命中维持中性灰。
 * 以后扩展关键词（新增背书词等）只改这一处；未登录置灰是独立规则，由渲染处
 * badgeClass 统一收口，与本函数无关。
 */
export function isOfficialKeywordLabel(label: string): boolean {
  return label.includes("官方");
}

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
  // 旧快照（HMR/新旧进程混跑）可能缺新字段：一律兜底空数组，展示层永不崩
  const tags = meta.tags ?? [];
  const customTags = meta.customTags ?? [];
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
      {tags.map((tag) => (
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
      {/* 自定义标签：文案命中「官方」关键词走官方蓝（与「限时折扣」同 token、同软底，
          无描边实底）；其余维持中性灰。形态与上方组合标签统一（TAG_BADGE_BASE）。
          未登录仍一律置灰——由 badgeClass 的 loggedIn 收口，规则不变。 */}
      {customTags.map((label) => (
        <span
          key={label}
          className={badgeClass(
            isOfficialKeywordLabel(label) ? OFFICIAL_KEYWORD_ACCENT_CLASS : TAG_GRAY_CLASS,
          )}
        >
          {label}
        </span>
      ))}
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
