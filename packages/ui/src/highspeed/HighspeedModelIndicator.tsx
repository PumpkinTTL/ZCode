/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import { motion, useReducedMotion } from "motion/react";
import lightningIconUrl from "@/assets/highspeed/lightning.svg";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const HIGHSPEED_MODEL_TRANSITION = {
  duration: 0.4,
  ease: [0.55, 0, 0.45, 1],
} as const;

export function HighspeedModelIndicator({
  model,
  originalModel,
  sweepActive,
  animateEntrance,
}: {
  model: string;
  originalModel: string;
  sweepActive: boolean;
  /** 仅 draw 新命中时播放翻页入场；切回或恢复时直接呈现静止标识。 */
  animateEntrance: boolean;
})  {
  return null as unknown as never;
}
