import { memo, useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquareText, Send, X } from "lucide-react";
import type { FeedbackTicketDetail } from "@zcode/shared";
import type { IFeedbackService } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Textarea } from "@/components/ui/textarea.js";
import { FeedbackErrorTip, StatusIndicator } from "@/feedback/feedbackBadges.js";
import { formatRelativeTime } from "@/feedback/feedbackUserView.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";

/**
 * 工单详情对话视图（独立组件）：只读渲染工单详情 + 往来消息流（用户/官方回复），
 * 底部可继续补充说明（feedbackService.comment）。
 *
 * 独立于 TicketsView 的既有布局：不改变工单列表的结构与样式，
 * 仅由列表行内「查看详情」按钮打开本弹窗；数据全部走既有服务面
 * （get / comment），不引入新的 host 协议。
 */
export const TicketDetailDialog = memo(function TicketDetailDialogComponent({
  feedbackService,
  ticketId,
  open,
  onClose,
}: {
  feedbackService: IFeedbackService;
  ticketId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const formatMessage = intl.formatMessage;
  const [detail, setDetail] = useState<FeedbackTicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await feedbackService.get(ticketId));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [feedbackService, ticketId]);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setReply("");
    void load();
  }, [open, load]);

  const handleSend = useCallback(async () => {
    const body = reply.trim();
    if (!ticketId || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      await feedbackService.comment(ticketId, body);
      setReply("");
      await load();
    } catch (sendError) {
      setError(getErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  }, [feedbackService, load, reply, sending, ticketId]);

  const comments = detail?.comments ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="grid h-[min(40rem,calc(100vh-2rem))] w-[min(34rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border border-popover-border bg-popover p-0 text-foreground shadow-md backdrop-blur-2xl max-sm:h-[calc(100vh-1rem)] max-sm:w-[calc(100vw-1rem)]"
      >
        <DialogHeader className="flex-row items-start justify-between gap-2 p-6 pb-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-ui-lg font-medium text-foreground">
              <span className="min-w-0 truncate">{detail?.title ?? formatMessage({ id: "feedback.ticketDetail.title" })}</span>
            </DialogTitle>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-ui-xs text-foreground-subtle">
              {detail ? <StatusIndicator status={detail.status} /> : null}
              {detail ? (
                <span className="min-w-0 truncate font-mono">{detail.id}</span>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={formatMessage({ id: "feedback.ticketDetail.close" })}
            title={formatMessage({ id: "feedback.ticketDetail.close" })}
            onClick={onClose}
            className="shrink-0 text-foreground-subtle hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 pb-3">
          {loading && !detail ? (
            <div className="flex items-center justify-center gap-2 py-10 text-ui-base text-foreground-subtle">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>{formatMessage({ id: "common.loading" })}</span>
            </div>
          ) : null}

          {error && !detail ? (
            <div className="py-3">
              <FeedbackErrorTip message={error} />
            </div>
          ) : null}

          {detail ? (
            <div className="flex flex-col gap-3">
              <section className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="mb-1 text-ui-xs font-medium text-foreground-subtle">
                  {formatMessage({ id: "feedback.ticketDetail.description" })}
                </div>
                <div className="whitespace-pre-wrap break-words text-ui-base leading-5 text-foreground">
                  {detail.description || "—"}
                </div>
                <div className="mt-2 text-ui-xs text-foreground-subtle">
                  {formatRelativeTime(detail.created_at, formatMessage)}
                </div>
              </section>

              {detail.attachments.length > 0 ? (
                <section className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="mb-1 text-ui-xs font-medium text-foreground-subtle">
                    {formatMessage({ id: "feedback.ticketDetail.attachments" })}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {detail.attachments.map((attachment) => (
                      <li
                        key={attachment.id}
                        className="flex min-w-0 items-center justify-between gap-2 text-ui-xs text-foreground"
                      >
                        <span className="min-w-0 truncate">{attachment.filename}</span>
                        <span className="shrink-0 text-foreground-subtle">
                          {formatAttachmentSize(attachment.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="flex flex-col gap-2">
                <div className="text-ui-xs font-medium text-foreground-subtle">
                  {formatMessage({ id: "feedback.ticketDetail.conversation" })}
                </div>
                {comments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-ui-xs text-foreground-subtle">
                    {formatMessage({ id: "feedback.ticketDetail.emptyThread" })}
                  </div>
                ) : (
                  comments.map((comment) => (
                    <article
                      key={comment.id}
                      className={
                        comment.is_staff
                          ? "rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
                          : "rounded-lg border border-border bg-card px-3 py-2"
                      }
                    >
                      <div className="flex items-center gap-2 text-ui-xs">
                        <span
                          className={
                            comment.is_staff
                              ? "font-medium text-primary"
                              : "font-medium text-foreground-subtle"
                          }
                        >
                          {comment.is_staff
                            ? formatMessage({ id: "feedback.ticketDetail.staff" })
                            : comment.author_display_name ||
                              formatMessage({ id: "feedback.ticketDetail.you" })}
                        </span>
                        <span className="text-foreground-subtle">
                          {formatRelativeTime(comment.created_at, formatMessage)}
                        </span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-ui-base leading-5 text-foreground">
                        {comment.body}
                      </div>
                      {comment.attachments && comment.attachments.length > 0 ? (
                        <ul className="mt-1.5 flex flex-col gap-0.5">
                          {comment.attachments.map((attachment) => (
                            <li
                              key={attachment.id}
                              className="flex min-w-0 items-center justify-between gap-2 text-ui-xs text-foreground-subtle"
                            >
                              <span className="min-w-0 truncate">{attachment.filename}</span>
                              <span className="shrink-0">
                                {formatAttachmentSize(attachment.size)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))
                )}
              </section>

              {error ? <FeedbackErrorTip message={error} /> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
          <Textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder={formatMessage({ id: "feedback.ticketDetail.replyPlaceholder" })}
            className="max-h-40 resize-none rounded-lg text-ui-base"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-ui-xs text-foreground-subtle">
              <MessageSquareText className="size-3 shrink-0" />
              <span className="truncate">
                {formatMessage({ id: "feedback.ticketDetail.replyHint" })}
              </span>
            </span>
            <Button
              size="sm"
              onClick={() => void handleSend()}
              disabled={sending || reply.trim().length === 0 || !detail}
              className="shrink-0 rounded-lg"
            >
              {sending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send />
              )}
              {formatMessage({
                id: sending ? "feedback.ticketDetail.sending" : "feedback.ticketDetail.send",
              })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
