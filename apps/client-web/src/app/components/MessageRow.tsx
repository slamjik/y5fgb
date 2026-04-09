import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  Forward,
  PencilLine,
  Reply,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";

import { innerCardStyle, outlineButtonStyle, selectedCardStyle } from "../styles";
import type { MessageAttachmentView, MessageRowAttachmentState, MessageView } from "../types";
import { formatBytes, linkifyText, renderDeliveryState } from "../view-utils";

const quickReactions = ["\u2764\uFE0F", "\u{1F44D}", "\u{1F602}", "\u{1F622}"] as const;

type MessageRowProps = {
  message: MessageView;
  replySource: MessageView | null;
  compactTop: boolean;
  highlighted: boolean;
  onJumpToMessage?: (messageId: string) => void;
  onReplyToMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string, mode: "me" | "all") => void;
  onForwardMessage: (messageId: string) => void;
  onResend?: () => Promise<void>;
  onEditMessage?: (messageId: string, nextText: string) => Promise<void>;
  attachmentPreviewState: Record<string, { loading: boolean; src: string | null; error: string }>;
  onEnsureAttachmentPreview?: (attachment: MessageAttachmentView) => void;
  onDownloadAttachment: (attachment: MessageAttachmentView) => Promise<void>;
  attachmentOpState: MessageRowAttachmentState;
  registerRef?: (messageId: string, el: HTMLDivElement | null) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
} | null;

export function MessageRow({
  message,
  replySource,
  compactTop,
  highlighted,
  onJumpToMessage,
  onReplyToMessage,
  onToggleReaction,
  onDeleteMessage,
  onForwardMessage,
  onResend,
  onEditMessage,
  attachmentPreviewState,
  onEnsureAttachmentPreview,
  onDownloadAttachment,
  attachmentOpState,
  registerRef,
}: MessageRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.text);
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null);
  const longPressTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!editing) {
      setEditValue(message.text);
    }
  }, [editing, message.text]);

  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  React.useEffect(() => {
    if (!onEnsureAttachmentPreview || message.deletedAt) return;
    for (const attachment of message.attachments) {
      if (attachment.kind !== "image") continue;
      const preview = attachmentPreviewState[attachment.id];
      if (!preview || (!preview.loading && !preview.src && !preview.error)) {
        onEnsureAttachmentPreview(attachment);
      }
    }
  }, [message.attachments, message.deletedAt, attachmentPreviewState, onEnsureAttachmentPreview]);

  const canEdit =
    message.own &&
    !message.deletedAt &&
    message.localStatus !== "sending" &&
    message.localStatus !== "failed" &&
    typeof onEditMessage === "function";

  const submitEdit = async () => {
    if (!onEditMessage) return;
    const normalized = editValue.trimEnd();
    if (normalized === message.text) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      await onEditMessage(message.id, normalized);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const openContextMenu = React.useCallback((x: number, y: number) => {
    const width = 210;
    const height = 260;
    const maxX = typeof window !== "undefined" ? window.innerWidth - width - 8 : x;
    const maxY = typeof window !== "undefined" ? window.innerHeight - height - 8 : y;
    setContextMenu({
      x: Math.max(8, Math.min(x, maxX)),
      y: Math.max(8, Math.min(y, maxY)),
    });
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const status = message.localStatus === "sending" ? "pending" : message.localStatus === "failed" ? "failed" : message.deliveryState;

  const statusIcon =
    status === "read" ? (
      <CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--accent-brown)" }} />
    ) : status === "delivered" ? (
      <CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--base-grey-light)" }} />
    ) : status === "sent" ? (
      <Check className="w-3.5 h-3.5" style={{ color: "var(--base-grey-light)" }} />
    ) : status === "failed" ? (
      <AlertCircle className="w-3.5 h-3.5" style={{ color: "#fca5a5" }} />
    ) : (
      <Clock3 className="w-3.5 h-3.5" style={{ color: "var(--base-grey-light)" }} />
    );

  const replyPreviewText = replySource
    ? replySource.deletedAt
      ? "Сообщение удалено"
      : replySource.text || (replySource.attachments.length > 0 ? "Вложение" : "Пустое сообщение")
    : "Оригинал сообщения недоступен";

  const onCopyText = async () => {
    if (!message.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      // clipboard is best effort
    }
  };

  return (
    <div
      ref={(el) => registerRef?.(message.id, el)}
      data-testid="message"
      data-message-id={message.id}
      className={`flex message-row-enter ${message.own ? "justify-end" : "justify-start"} ${compactTop ? "mt-1" : "mt-3"}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu(event.clientX, event.clientY);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        clearLongPress();
        const x = event.clientX;
        const y = event.clientY;
        longPressTimerRef.current = window.setTimeout(() => {
          openContextMenu(x, y);
        }, 450);
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerMove={clearLongPress}
    >
      <div
        className="max-w-[88%] lg:max-w-[78%] rounded-2xl border px-3 py-2 space-y-2 interactive-surface-subtle"
        style={
          message.own
            ? {
                ...selectedCardStyle,
                borderColor: highlighted ? "#f5d0a9" : "var(--accent-brown)",
                boxShadow: highlighted ? "0 0 0 1px rgba(245, 208, 169, 0.7)" : undefined,
              }
            : {
                ...innerCardStyle,
                borderColor: highlighted ? "#f5d0a9" : innerCardStyle.borderColor,
                boxShadow: highlighted ? "0 0 0 1px rgba(245, 208, 169, 0.7)" : undefined,
              }
        }
      >
        {message.forwardedFromMessageId ? (
          <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Переслано</p>
        ) : null}

        {message.replyToMessageId ? (
          <button
            type="button"
            data-testid="reply"
            className="w-full text-left rounded-lg border px-2 py-1"
            style={innerCardStyle}
            onClick={() => {
              if (message.replyToMessageId) {
                onJumpToMessage?.(message.replyToMessageId);
              }
            }}
          >
            <p className="truncate" style={{ color: "var(--base-grey-light)", fontSize: 11 }}>
              Ответ на сообщение
            </p>
            <p className="truncate" style={{ color: "var(--text-primary)", fontSize: 12 }}>
              {replyPreviewText}
            </p>
          </button>
        ) : null}

        {message.deletedAt ? (
          <p style={{ color: "var(--base-grey-light)", fontStyle: "italic" }}>Сообщение удалено</p>
        ) : editing ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none resize-none"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)", minHeight: 72 }}
              disabled={savingEdit}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => {
                  setEditValue(message.text);
                  setEditing(false);
                }}
                disabled={savingEdit}
              >
                <X className="w-3.5 h-3.5 inline mr-1" />
                Отмена
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => void submitEdit()}
                disabled={savingEdit}
              >
                <Check className="w-3.5 h-3.5 inline mr-1" />
                {savingEdit ? "Сохраняем..." : "Сохранить"}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{linkifyText(message.text)}</p>
        )}

        {!message.deletedAt && message.attachments.length > 0 ? (
          <div className="space-y-2">
            {message.attachments.map((attachment) => {
              const op = attachmentOpState[attachment.id];
              const preview = attachmentPreviewState[attachment.id];
              const isImage = attachment.kind === "image";
              return (
                <div key={attachment.id} className="rounded-lg border px-3 py-2 space-y-2 interactive-surface-subtle" style={innerCardStyle}>
                  {isImage ? (
                    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--glass-border)" }}>
                      {preview?.src ? (
                        <img
                          src={preview.src}
                          alt={attachment.fileName}
                          className="w-full max-h-[240px] object-cover cursor-pointer"
                          onClick={() => void onDownloadAttachment(attachment)}
                        />
                      ) : (
                        <div className="w-full h-32 flex items-center justify-center" style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                          {preview?.loading
                            ? "Загрузка изображения..."
                            : preview?.error
                              ? "Превью недоступно"
                              : "Подготовка превью..."}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: "var(--text-primary)" }}>{attachment.fileName}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                        {isImage ? "Image" : "File"} · {formatBytes(attachment.sizeBytes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg border text-xs"
                      style={outlineButtonStyle}
                      onClick={() => void onDownloadAttachment(attachment)}
                      disabled={op?.loading}
                    >
                      <Download className="w-4 h-4 inline mr-1" />
                      {op?.loading ? "Загрузка..." : "Download"}
                    </button>
                  </div>
                  {preview?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{preview.error}</p> : null}
                  {op?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{op.error}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {!message.deletedAt ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                data-testid="reaction"
                className="px-2 py-0.5 rounded-full border text-xs"
                style={reaction.reactedByMe ? selectedCardStyle : innerCardStyle}
                onClick={() => onToggleReaction(message.id, reaction.emoji)}
              >
                {reaction.emoji} {reaction.count}
              </button>
            ))}
            {quickReactions.map((emoji) => (
              <button
                key={`quick-${emoji}`}
                type="button"
                data-testid="reaction"
                className="px-1.5 py-0.5 rounded-full border text-xs"
                style={outlineButtonStyle}
                onClick={() => onToggleReaction(message.id, emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p style={{ color: "var(--base-grey-light)", fontSize: 11 }}>
            {message.localStatus === "failed" ? "Не отправлено" : new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            {message.editedAt ? " · изменено" : ""}
          </p>
          <div className="flex items-center gap-1.5" title={renderDeliveryState(status)}>
            {statusIcon}
            {canEdit && !editing ? (
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => setEditing(true)}
                aria-label="Edit message"
              >
                <PencilLine className="w-3.5 h-3.5" />
              </button>
            ) : null}
            {message.localStatus === "failed" && onResend ? (
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => void onResend()}
              >
                <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div className="fixed inset-0 z-[90]" onClick={() => setContextMenu(null)}>
          <div
            className="absolute rounded-xl border p-1.5 w-[210px] menu-popover-motion"
            style={{
              ...cardStyle,
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <ActionItem
              testId="message-action-reply"
              icon={<Reply className="w-4 h-4" />}
              label="Ответить"
              onClick={() => {
                onReplyToMessage(message.id);
                setContextMenu(null);
              }}
            />
            <ActionItem
              testId="message-action-copy"
              icon={<Copy className="w-4 h-4" />}
              label="Скопировать"
              onClick={() => {
                void onCopyText();
                setContextMenu(null);
              }}
              disabled={!message.text}
            />
            {canEdit ? (
              <ActionItem
                testId="message-action-edit"
                icon={<PencilLine className="w-4 h-4" />}
                label="Редактировать"
                onClick={() => {
                  setEditing(true);
                  setContextMenu(null);
                }}
              />
            ) : null}
            <ActionItem
              testId="message-action-delete-me"
              icon={<Trash2 className="w-4 h-4" />}
              label="Удалить у себя"
              onClick={() => {
                onDeleteMessage(message.id, "me");
                setContextMenu(null);
              }}
            />
            {message.own ? (
              <ActionItem
                testId="message-action-delete-all"
                icon={<Trash2 className="w-4 h-4" />}
                label="Удалить у всех"
                onClick={() => {
                  onDeleteMessage(message.id, "all");
                  setContextMenu(null);
                }}
              />
            ) : null}
            <ActionItem
              testId="message-action-forward"
              icon={<Forward className="w-4 h-4" />}
              label="Переслать"
              onClick={() => {
                onForwardMessage(message.id);
                setContextMenu(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionItem({
  testId,
  icon,
  label,
  onClick,
  disabled,
}: {
  testId?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center gap-2 border"
      style={outlineButtonStyle}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{label}</span>
    </button>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "rgba(15, 15, 15, 0.92)",
  borderColor: "var(--glass-border)",
  backdropFilter: "blur(10px)",
};
