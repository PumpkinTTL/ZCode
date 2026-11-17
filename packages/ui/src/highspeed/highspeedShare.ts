/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */
import type { GlobalNoticeEnvelope } from "@/global-notice/globalNoticeStore.js";
import type { HighspeedShareMetrics } from "@/highspeed/highspeedTurnStore.js";
import { calculateHighspeedSavedDurationMs } from "@/highspeed/highspeedSavedTime.js";

export const HIGHSPEED_NOTICE_DISMISS_COOLDOWN_MS = 24 * 60 * 60_000;
export const HIGHSPEED_NOTICE_AUTO_CLOSE_MS = 24 * 60 * 60_000;
export const MIN_HIGHSPEED_SHARE_SPEEDUP = 1.2;
/**
 * 左下角分享卡通知的 payload。指标一律以毫秒事实携带（与发布门禁 isHighspeedShareEligible 同精度），
 * 秒级展示值由渲染侧派生；durationSeconds/savedDurationSeconds 只是 ≤24h 内遗留持久化通知的兼容读取字段。
 */
export interface HighspeedShareNoticePayload extends Record<string, unknown> {
  cardId: string;
  tokenUsage: number;
  durationMs?: number;
  savedDurationMs?: number;
  /** @deprecated 旧版秒级取整字段，只读兼容，不再写入。 */
  durationSeconds?: number;
  /** @deprecated 旧版秒级取整字段，只读兼容，不再写入。 */
  savedDurationSeconds?: number;
}

export async function copyHighspeedShareText(
  text: string,
  writeText: (value: string) => Promise<void> = async (value) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      throw new Error("text clipboard is unavailable");
    }
    await navigator.clipboard.writeText(value);
  },
): Promise<void>  {
  return null as unknown as never;
}

/** 紧凑时长：>=60s 显示分钟，否则秒；加速标签与导出图片共用，跨语言保持一致的紧凑单位。 */
export function formatHighspeedDurationShort(durationMs: number): string  {
  return null as unknown as never;
}

function resolveHighspeedSavedDurationMs(metrics: HighspeedShareMetrics): number {
  return metrics.savedDurationMs ?? calculateHighspeedSavedDurationMs(metrics);
}

/**
 * 分享入口只对完整且可信的卡级数据开放，避免低收益或缺少耗时的结果生成误导性分享卡。
 * 这里使用未四舍五入的倍率，确保 1.2x 边界稳定，展示层的格式化不会影响资格判断。
 */
export function isHighspeedShareEligible(metrics: HighspeedShareMetrics): boolean  {
  return null as unknown as never;
}

/** 优先使用 CLI 真实耗时；旧消息回退到工具 20% / 模型 80% 估算。 */
export function highspeedSpeedup(metrics: HighspeedShareMetrics): number  {
  return null as unknown as never;
}

/** 时间节省比例（%），按真实拆分或兼容的 20/80 口径计算。 */
export function highspeedSavedPercent(metrics: HighspeedShareMetrics): number  {
  return null as unknown as never;
}

const HIGHSPEED_CARD_IMAGE_SIZE = { width: 436, height: 304 } as const;

export interface HighspeedShareImageLabels {
  benefit: string;
  standardSpeed: string;
  speedSummary: string;
  lessWaiting: string;
  imageSummary: string;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

/** 与 useTheme 的 applyTheme 一致：根节点 dark class 即暗色；无 DOM 时按暗色品牌卡兜底。 */
function detectHighspeedCardDarkTheme(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement?.classList?.contains("dark") ?? true;
}

/** 将统计区渲染为独立 SVG，复制图片时不会把弹框底部文案和按钮带进去。 */
export async function copyHighspeedCardImage(
  metrics: HighspeedShareMetrics,
  writeImage: (blob: Blob) => Promise<void> = async (blob) => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof ClipboardItem === "undefined"
    ) {
      throw new Error("image clipboard is unavailable");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  },
  labels?: HighspeedShareImageLabels,
): Promise<void>  {
  return null as unknown as never;
}

export function buildHighspeedShareNotice(params: {
  cardId: string;
  metrics: HighspeedShareMetrics;
  now?: number;
}): GlobalNoticeEnvelope  {
  return null as unknown as never;
}

export function isHighspeedShareNoticePayload(
  payload: Record<string, unknown>,
): payload is HighspeedShareNoticePayload  {
  return null as unknown as never;
}

/**
 * 由通知 payload 还原分享指标：毫秒字段优先（与发布门禁同精度，复检结果必然一致）；
 * 遗留秒级 payload 按 ×1000 兜底。TPS 只为满足 isHighspeedShareEligible 的正数校验而合成，
 * 倍率与节省比例全部由 durationMs + savedDurationMs 计算，不依赖合成 TPS。
 */
export function resolveHighspeedShareNoticeMetrics(
  payload: HighspeedShareNoticePayload,
): HighspeedShareMetrics  {
  return null as unknown as never;
}
