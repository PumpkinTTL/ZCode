import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const MODEL_INPUT_CAPABILITY_BADGE_CLASS_NAME =
  "pointer-events-none inline-flex shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface/70 px-1.5 h-5 text-ui-xs font-medium leading-none text-foreground-subtle select-none";

export function ModelInputCapabilityBadge({ className }: { className?: string }) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "model.capability.vision" });

  return (
    <span
      className={cn(MODEL_INPUT_CAPABILITY_BADGE_CLASS_NAME, className)}
      data-model-input-capability="vision"
      aria-label={label}
      title={label}
    >
      {label}
    </span>
  );
}
