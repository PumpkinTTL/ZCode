/**
 * 系统公告条（GET /api/v1/user/notice，公开端点）。
 *
 * 同一组件渲染在两处：WelcomeScreen 登录卡片上方与设置页「我的额度」分区顶部。
 * - 有公告才渲染（enabled=true 且 content 非空）；
 * - 带关闭按钮：按公告内容哈希（后端公告无独立 id，内容即版本）记 localStorage
 *   「已关闭」，同一条不再打扰；管理员改公告内容后哈希变化，新公告重新出现；
 * - 数据来自 noticeState 共享快照（与全站灰挂点共享同一次请求），不在组件里各自拉取。
 */
import { useCallback, useState } from "react";
import { MegaphoneIcon, XIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useSystemNotice } from "./noticeState.js";

/** localStorage 键：最近一次被用户关闭的公告标识（内容哈希）。 */
const DISMISSED_NOTICE_STORAGE_KEY = "polaris.system-notice.dismissed";

/**
 * 公告版本标识：djb2 内容哈希（base36）。公告无独立 id 字段，内容变化即新公告；
 * 哈希只用于本地「已读」记忆，不参与任何展示。
 */
function noticeId(content: string): string {
  let hash = 5381;
  for (let index = 0; index < content.length; index++) {
    hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function readDismissedNoticeId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_NOTICE_STORAGE_KEY);
  } catch (error) {
    // localStorage 被禁用/清空时机不可控：读不到就当没关过，公告照常展示。
    logger.warn("[notice] 读取公告已读记忆失败，按未关闭处理", { error });
    return null;
  }
}

function writeDismissedNoticeId(id: string): void {
  try {
    localStorage.setItem(DISMISSED_NOTICE_STORAGE_KEY, id);
  } catch (error) {
    logger.warn("[notice] 写入公告已读记忆失败，下次仍会展示", { error });
  }
}

export function NimbusNoticeBar() {
  const { intl } = useZCodeIntl();
  const { notice } = useSystemNotice();
  const [dismissedId, setDismissedId] = useState<string | null>(readDismissedNoticeId);

  const handleDismiss = useCallback(() => {
    if (!notice) return;
    const id = noticeId(notice.content);
    writeDismissedNoticeId(id);
    setDismissedId(id);
  }, [notice]);

  // 有公告才渲染：enabled=false 或内容为空一律不占位。
  if (!notice?.enabled) return null;
  const content = notice.content.trim();
  if (!content || dismissedId === noticeId(content)) return null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3.5 py-2.5 shadow-2xs"
      data-system-notice=""
      role="note"
    >
      <MegaphoneIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-ui-xs font-medium leading-none text-amber-700 dark:border-amber-500/25 dark:text-amber-300">
        {intl.formatMessage({ id: "business.quota.noticeLabel" })}
      </span>
      <p className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle">{content}</p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={intl.formatMessage({ id: "business.quota.noticeDismiss" })}
        title={intl.formatMessage({ id: "business.quota.noticeDismiss" })}
        className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-subtle outline-none transition-colors hover:bg-hover hover:text-foreground cursor-pointer"
      >
        <XIcon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
