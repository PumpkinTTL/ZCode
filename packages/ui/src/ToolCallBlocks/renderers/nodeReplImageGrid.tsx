import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ImagePreviewDialog } from "@/components/ai-elements/image-preview-dialog.js";
import {
  ImageThumbnailGallery,
  imageThumbnailClassName,
  imageThumbnailTriggerClassName,
} from "@/components/ai-elements/image-thumbnail-gallery.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { NodeReplDisplayModel } from "@/lib/nodeReplToolDisplay.js";
import {
  getScreenshotObjectUrlVersion,
  resolveScreenshotObjectUrl,
  subscribeScreenshotObjectUrls,
} from "@/lib/screenshotObjectUrlCache.js";

export function NodeReplImageGrid({
  images,
  resultImageLabel,
}: {
  images: ReadonlyArray<NodeReplDisplayModel["images"][number]>;
  resultImageLabel: string;
}) {
  const { intl } = useZCodeIntl();
  // 截图解码完成/驱逐后重渲染：src 渲染期经缓存解析（objectURL 优先，
  // 未命中回落 data URL 并后台解码），避免整条会话的 base64 字符串常驻 DOM。
  useSyncExternalStore(subscribeScreenshotObjectUrls, getScreenshotObjectUrlVersion);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previewItems = useMemo(
    () =>
      images.map((image, index) => ({
        alt: `${resultImageLabel} ${index + 1}`,
        filename: `result-image-${index + 1}`,
        src: resolveScreenshotObjectUrl(
          `${image.mimeType}:${image.base64.length}:${image.base64.slice(0, 24)}`,
          image.mimeType,
          image.base64,
        ),
      })),
    [images, resultImageLabel],
  );
  const openImageLabel = intl.formatMessage({
    id: "chat.attachments.preview.open",
  });

  const handleOpenChange = (open: boolean) => {
    setPreviewOpen(open);
    if (!open) {
      window.setTimeout(() => triggerRefs.current[previewIndex]?.focus(), 0);
    }
  };

  return (
    <>
      <ImageThumbnailGallery data-node-repl-image-gallery="" grouped={previewItems.length >= 2}>
        {previewItems.map((item, index) => (
          <button
            ref={(node) => {
              triggerRefs.current[index] = node;
            }}
            type="button"
            aria-label={`${openImageLabel} ${index + 1}`}
            className={imageThumbnailTriggerClassName}
            data-image-thumbnail-trigger=""
            key={`${images[index]?.mimeType}:${images[index]?.base64.length}:${index}`}
            onClick={() => {
              setPreviewIndex(index);
              setPreviewOpen(true);
            }}
          >
            <img
              alt={item.alt}
              className={imageThumbnailClassName}
              draggable={false}
              loading="lazy"
              src={item.src}
            />
          </button>
        ))}
      </ImageThumbnailGallery>
      <ImagePreviewDialog
        dialogTestId="node-repl-image-lightbox"
        imageTestId="node-repl-image-lightbox-image"
        initialIndex={previewIndex}
        items={previewItems}
        onOpenChange={handleOpenChange}
        open={previewOpen}
      />
    </>
  );
}
