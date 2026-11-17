/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import { useEffect, useState, type CSSProperties } from "react";
import { CopyIcon, EyeIcon, XIcon, ZapIcon } from "lucide-react";
import { animate, motion, useReducedMotion } from "motion/react";
import shareCardDarkBackgroundUrl from "@/assets/highspeed/share-card.svg";
import shareCardLightBackgroundUrl from "@/assets/highspeed/share-card-light.svg";
import shareDialogNoiseUrl from "@/assets/highspeed/share-dialog-noise.png";
import shareDialogNoiseLightUrl from "@/assets/highspeed/share-dialog-noise-light.png";
import zaiLogoUrl from "@/assets/highspeed/zai-logo.png";
import { Button } from "@/components/ui/button.js";
import { ZCodeWordmarkLogo } from "@/components/ui/ZCodeAboutLogo.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.js";
import type { GlobalNoticeEnvelope } from "@/global-notice/globalNoticeStore.js";
import {
  copyHighspeedCardImage,
  copyHighspeedShareText,
  formatHighspeedDurationShort,
  highspeedSavedPercent,
  highspeedSpeedup,
  isHighspeedShareEligible,
  isHighspeedShareNoticePayload,
  resolveHighspeedShareNoticeMetrics,
} from "@/highspeed/highspeedShare.js";
import { calculateHighspeedSavedDurationMs } from "@/highspeed/highspeedSavedTime.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";

export function HighspeedShareNoticeCard({
  notice,
  onDismiss,
}: {
  notice: GlobalNoticeEnvelope;
  onDismiss: () => void;
})  {
  return null as unknown as never;
}

/** 数字从 0 增长到目标值；reduced-motion 或禁用时直接呈现终值。节奏与卡片各区块的 fade-up 交错对齐。 */
function useCountUpNumber(
  target: number,
  { enabled, delayMs, durationMs }: { enabled: boolean; delayMs: number; durationMs: number },
) {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    setValue(0);
    const controls = animate(0, target, {
      duration: durationMs / 1000,
      delay: delayMs / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setValue,
    });
    return () => controls.stop();
  }, [target, enabled, delayMs, durationMs]);
  return value;
}

export function HighspeedShareDialog({
  metrics,
  open,
  onOpenChange,
}: {
  metrics: {
    outputTokens: number;
    durationMs: number;
    regularTps: number;
    highspeedTps: number;
    savedDurationMs?: number;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
})  {
  return null as unknown as never;
}
