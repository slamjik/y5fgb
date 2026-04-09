import { Check, Download, PencilLine, X } from "lucide-react";
import * as React from "react";

import { innerCardStyle, outlineButtonStyle, selectedCardStyle } from "../styles";
import type { MessageAttachmentView, MessageRowAttachmentState, MessageView } from "../types";
import { formatBytes, linkifyText, renderDeliveryState } from "../view-utils";

export function MessageRow({
  message,
  onResend,
  onEditMessage,
  attachmentPreviewState,
  onEnsureAttachmentPreview,
  onDownloadAttachment,
  attachmentOpState,
}: {
  message: MessageView;
  onResend?: () => Promise<void>;
  onEditMessage?: (messageId: string, nextText: string) => Promise<void>;
  attachmentPreviewState: Record<string, { loading: boolean; src: string | null; error: string }>;
  onEnsureAttachmentPreview?: (attachment: MessageAttachmentView) => void;
  onDownloadAttachment: (attachment: MessageAttachmentView) => Promise<void>;
  attachmentOpState: MessageRowAttachmentState;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(message.text);
  const [savingEdit, setSavingEdit] = React.useState(false);

  React.useEffect(() => {
    if (!editing) {
      setEditValue(message.text);
    }
  }, [editing, message.text]);

  const canEdit =
    message.own &&
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

  React.useEffect(() => {
    if (!onEnsureAttachmentPreview) return;
    for (const attachment of message.attachments) {
      if (attachment.kind !== "image") continue;
      const preview = attachmentPreviewState[attachment.id];
      if (!preview || (!preview.loading && !preview.src && !preview.error)) {
        onEnsureAttachmentPreview(attachment);
      }
    }
  }, [message.attachments, attachmentPreviewState, onEnsureAttachmentPreview]);

  return (
    <div className={`flex message-row-enter ${message.own ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[78%] rounded-2xl border px-3 py-2 space-y-1 interactive-surface-subtle"
        style={message.own ? { ...selectedCardStyle, borderColor: "var(--accent-brown)" } : innerCardStyle}
      >
        {editing ? (
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
                Cancel
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => void submitEdit()}
                disabled={savingEdit}
              >
                <Check className="w-3.5 h-3.5 inline mr-1" />
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {linkifyText(message.text)}
          </p>
        )}
        {message.attachments.length > 0 ? (
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
                          {preview?.loading ? "Loading image..." : preview?.error ? "Image preview unavailable" : "Preparing preview..."}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>{attachment.fileName}</p>
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
                      {op?.loading ? "Downloading..." : "Download"}
                    </button>
                  </div>
                  {preview?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{preview.error}</p> : null}
                  {op?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{op.error}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <p style={{ color: "var(--base-grey-light)", fontSize: 11 }}>
            {message.localStatus === "sending"
              ? "Sending..."
              : message.localStatus === "failed"
                ? "Send failed"
                : renderDeliveryState(message.deliveryState)}
            {message.editedAt ? " · edited" : ""}
          </p>
          <div className="flex items-center gap-1.5">
            {canEdit && !editing ? (
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => setEditing(true)}
                aria-label="Edit message"
              >
                <PencilLine className="w-3.5 h-3.5 inline mr-1" />
                Edit
              </button>
            ) : null}
            {message.localStatus === "failed" && onResend ? (
              <button
                type="button"
                className="px-2 py-1 rounded-lg border text-xs"
                style={outlineButtonStyle}
                onClick={() => void onResend()}
              >
                Retry
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
