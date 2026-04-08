import { Download } from "lucide-react";
import React from "react";

import { innerCardStyle, outlineButtonStyle, selectedCardStyle } from "../styles";
import type { MessageAttachmentView, MessageRowAttachmentState, MessageView } from "../types";
import { formatBytes, linkifyText, renderDeliveryState } from "../view-utils";

export function MessageRow({
  message,
  onResend,
  onDownloadAttachment,
  attachmentOpState,
}: {
  message: MessageView;
  onResend?: () => Promise<void>;
  onDownloadAttachment: (attachment: MessageAttachmentView) => Promise<void>;
  attachmentOpState: MessageRowAttachmentState;
}) {
  return (
    <div className={`flex ${message.own ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[78%] rounded-2xl border px-3 py-2 space-y-1"
        style={message.own ? { ...selectedCardStyle, borderColor: "var(--accent-brown)" } : innerCardStyle}
      >
        <p style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {linkifyText(message.text)}
        </p>
        {message.attachments.length > 0 ? (
          <div className="space-y-2">
            {message.attachments.map((attachment) => {
              const op = attachmentOpState[attachment.id];
              return (
                <div key={attachment.id} className="rounded-lg border px-3 py-2 space-y-2" style={innerCardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>{attachment.fileName}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                        {attachment.kind === "image" ? "Изображение" : "Файл"} · {formatBytes(attachment.sizeBytes)}
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
                      {op?.loading ? "Скачиваем..." : "Скачать"}
                    </button>
                  </div>
                  {op?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{op.error}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <p style={{ color: "var(--base-grey-light)", fontSize: 11 }}>
            {message.localStatus === "sending"
              ? "Отправляем..."
              : message.localStatus === "failed"
                ? "Ошибка отправки"
                : renderDeliveryState(message.deliveryState)}
          </p>
          {message.localStatus === "failed" && onResend ? (
            <button
              type="button"
              className="px-2 py-1 rounded-lg border text-xs"
              style={outlineButtonStyle}
              onClick={() => void onResend()}
            >
              Повторить
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

