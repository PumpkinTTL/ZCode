import { MODEL_ICON_SHAPES } from "@/assets/model-icons/modelIconShapes.js";
import { cn } from "@/components/lib/utils.js";
import { resolveModelIconSlug } from "@/lib/modelIcon.js";

/**
 * 模型品牌标。只有认得出品牌时才画品牌标；认不出就退回通用标，
 * 避免把 A 厂的标贴在 B 厂的模型上。
 */
export function ModelBrandIcon({
  modelId,
  providerId,
  className,
}: {
  modelId: string;
  providerId?: string | null;
  className?: string;
}) {
  const slug = resolveModelIconSlug(modelId, providerId);
  const shapes = slug ? MODEL_ICON_SHAPES[slug] : undefined;
  if (!shapes) {
    return <GenericModelIcon className={className} />;
  }

  return (
    <svg
      role="img"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      data-model-icon={slug}
      className={cn("shrink-0", className)}
    >
      {shapes.map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          fillOpacity={shape.fillOpacity}
          fillRule={shape.fillRule}
        />
      ))}
    </svg>
  );
}

/** 品牌未知时的兜底标记；与 ProviderLogo 的缺省图标保持同一枚方盒语义。 */
export function GenericModelIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-model-icon="generic"
      className={cn("shrink-0", className)}
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  );
}
