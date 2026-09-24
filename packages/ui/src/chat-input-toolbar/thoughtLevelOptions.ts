import type { ZCodeConfigOption, ZCodeProvider } from "@zcode/shared";
import type { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getConfigOptionEntryLabel } from "@/chat-input-toolbar/display.js";

type ThoughtLevelEntry = NonNullable<ZCodeConfigOption["options"]>[number];

const NO_THOUGHT_LEVEL_VALUES = new Set([
  "disabled",
  "false",
  "no",
  "none",
  "nothink",
  "no-think",
  "no_think",
  "off",
]);

const THOUGHT_LEVEL_LABEL_IDS: Record<string, string> = {
  disabled: "chat.toolbar.thoughtLevel.value.off",
  false: "chat.toolbar.thoughtLevel.value.off",
  no: "chat.toolbar.thoughtLevel.value.off",
  none: "chat.toolbar.thoughtLevel.value.off",
  nothink: "chat.toolbar.thoughtLevel.value.off",
  "no-think": "chat.toolbar.thoughtLevel.value.off",
  no_think: "chat.toolbar.thoughtLevel.value.off",
  off: "chat.toolbar.thoughtLevel.value.off",
  enable: "chat.toolbar.thoughtLevel.value.on",
  enabled: "chat.toolbar.thoughtLevel.value.on",
  on: "chat.toolbar.thoughtLevel.value.on",
  true: "chat.toolbar.thoughtLevel.value.on",
  low: "chat.toolbar.thoughtLevel.value.low",
  minimal: "chat.toolbar.thoughtLevel.value.minimal",
  medium: "chat.toolbar.thoughtLevel.value.medium",
  high: "chat.toolbar.thoughtLevel.value.high",
  "extra-high": "chat.toolbar.thoughtLevel.value.xhigh",
  extra_high: "chat.toolbar.thoughtLevel.value.xhigh",
  xhigh: "chat.toolbar.thoughtLevel.value.xhigh",
  max: "chat.toolbar.thoughtLevel.value.max",
  ultra: "chat.toolbar.thoughtLevel.value.ultra",
};

function normalizeThoughtLevelText(value: string): string {
  return value.trim().toLowerCase();
}

export function isNoThoughtLevel(entry: ThoughtLevelEntry): boolean {
  return NO_THOUGHT_LEVEL_VALUES.has(normalizeThoughtLevelText(entry.value));
}

export function getNextThoughtLevelValue(
  option: Pick<ZCodeConfigOption, "type" | "currentValue" | "options">,
): string | null {
  if (option.type !== "select" || !option.options || option.options.length < 2) {
    return null;
  }

  // 配置已声明档位顺序；名称别名只用于展示，不能改变菜单或快捷键顺序。
  const entries = option.options;
  const currentValue = String(option.currentValue);
  const currentIndex = entries.findIndex((candidate) => candidate.value === currentValue);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % entries.length;

  return entries[nextIndex]?.value ?? null;
}

/**
 * 开关型档位值：表达「思考开/关」的机器标志，不是一个被设定的档位名。
 *
 * 它们在配置里叫 `disabled` / `enabled`，但界面上说「关闭」「开启」更清楚，
 * 所以这一类继续走本地化词表；分级的档位（low / high / max / xhigh …）才用配置名。
 */
const THOUGHT_LEVEL_FLAG_VALUES = new Set([
  ...NO_THOUGHT_LEVEL_VALUES,
  "enable",
  "enabled",
  "on",
  "true",
]);

type FormatMessage = (
  descriptor: { id: string },
  values?: Record<string, string | number>,
) => string;

/**
 * 只有裸档位值可用时的标签（工具输出、运行记录、历史会话这类拿不到模型配置的场景）。
 *
 * 与 `getThoughtLevelLabel` 是同一条规则，只是少了「配置名」这一路输入：
 * 分级档位原样显示（配置名就是它，工具栏也这么显示），开关型档位才用本地化词。
 * 三处必须一致，否则同一个档位在工具栏和工具卡里会显示成两个词。
 */
export function resolveThoughtLevelValueLabel(value: string, formatMessage: FormatMessage): string {
  const normalized = normalizeThoughtLevelText(value);
  if (!THOUGHT_LEVEL_FLAG_VALUES.has(normalized)) {
    return value;
  }
  const labelId = THOUGHT_LEVEL_LABEL_IDS[normalized];
  return labelId ? formatMessage({ id: labelId }) : value;
}

export function getThoughtLevelLabel(
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  provider: ZCodeProvider | undefined,
  option: ZCodeConfigOption,
  entry: ThoughtLevelEntry,
): string {
  const value = normalizeThoughtLevelText(entry.value);
  const configuredLabel = getConfigOptionEntryLabel(intl, provider, option, entry).trim();

  // 分级档位用配置名：它就是用户在「编辑模型 → 推理档位」里设定的那一份，
  // 界面必须与之一致（曾把 max 硬翻成「最高」，与配置不符）。
  if (configuredLabel && !THOUGHT_LEVEL_FLAG_VALUES.has(value)) {
    return configuredLabel;
  }

  // 开关型档位与缺名场景回落到本地化词表；都没有才用裸 value。
  const fallback = resolveThoughtLevelValueLabel(entry.value, intl.formatMessage);
  return fallback === entry.value ? (configuredLabel || entry.value) : fallback;
}
