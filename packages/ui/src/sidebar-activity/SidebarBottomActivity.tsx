import { GlobalNoticeSurface } from "@/global-notice/GlobalNoticeSurface.js";
import type { GlobalNoticeStore } from "@/global-notice/globalNoticeStore.js";

/**
 * 左下角活动共享槽位的仲裁层：整个 UI 中唯一同时依赖营销触达与全局通知两套系统的地方，
 * 以此把这份耦合收敛到单点，保持两个 feature 模块互不 import（不制造循环依赖）。
 *
 * 纯只读投影，不持有任何状态。Polaris：领 token banner 与 highspeed 分享卡已随红线砍除，
 * 槽位只承载全局通知；不可见时 GlobalNoticeSurface 返回 null，不产生多余 DOM。
 */
export function SidebarBottomActivity({
  noticeStore,
}: {
  noticeStore?: GlobalNoticeStore | null;
} = {}) {
  // Polaris：marketing banner 已随红线砍除；槽位只保留全局通知。
  // 未注入时走 GlobalNoticeSurface 默认的 browserGlobalNoticeStore。
  return <GlobalNoticeSurface store={noticeStore ?? undefined} />;
}
