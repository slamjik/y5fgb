import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useAuthStore } from "@/state/authStore";
import { type LocalMessage, useMessagingStore } from "@/state/messagingStore";

type PlaintextAttachment = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  symmetricKey: string;
  nonce: string;
  checksumSha256: string;
  algorithm: string;
};

export function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId = "" } = useParams();
  const session = useAuthStore((state) => state.session);
  const conversation = useMessagingStore((state) => state.conversations.find((item) => item.id === conversationId) ?? null);
  const messages = useMessagingStore((state) => state.messagesByConversation[conversationId] ?? []);
  const outbox = useMessagingStore((state) => state.outbox);
  const transport = useMessagingStore((state) => state.transport);

  const [messageText, setMessageText] = useState("");
  const [ttlInput, setTTLInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [clock, setClock] = useState(Date.now());
  const [downloadingByAttachment, setDownloadingByAttachment] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let disposed = false;
    setLoadingMessages(true);
    setError(null);

    void messagingRuntime
      .loadMessages(conversationId)
      .catch((loadError) => {
        if (!disposed) {
          setError(extractApiErrorMessage(loadError));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoadingMessages(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedMessages = useMemo(
    () => [...messages].sort((left, right) => left.envelope.serverSequence - right.envelope.serverSequence),
    [messages],
  );

  const conversationOutbox = useMemo(() => outbox.filter((item) => item.conversationId === conversationId), [conversationId, outbox]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !messageText.trim()) {
      return;
    }

    setSending(true);
    setError(null);
    try {
      const uploads = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );

      const ttl = ttlInput.trim() ? Number(ttlInput.trim()) : undefined;
      await messagingRuntime.sendMessage({
        conversation,
        text: messageText.trim(),
        ttlSeconds: Number.isFinite(ttl) ? ttl : undefined,
        uploads,
      });
      setMessageText("");
      setTTLInput("");
      setFiles([]);
    } catch (sendError) {
      setError(extractApiErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  }

  async function handleDownloadAttachment(attachment: PlaintextAttachment) {
    setDownloadingByAttachment((state) => ({ ...state, [attachment.attachmentId]: true }));
    setError(null);

    try {
      const downloaded = await messagingRuntime.downloadAttachment({
        attachmentId: attachment.attachmentId,
        symmetricKey: attachment.symmetricKey,
        nonce: attachment.nonce,
        checksumSha256: attachment.checksumSha256,
      });
      const blobBytes = new Uint8Array(downloaded.bytes);
      const blob = new Blob([blobBytes], { type: downloaded.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloaded.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(extractApiErrorMessage(downloadError));
    } finally {
      setDownloadingByAttachment((state) => ({ ...state, [attachment.attachmentId]: false }));
    }
  }

  if (!conversation) {
    return (
      <section>
        <h1>{t("messaging.conversationsTitle")}</h1>
        <p className="text-muted">{t("messaging.conversationNotFound")}</p>
      </section>
    );
  }

  return (
    <section>
      <h1>{conversation.title || t("messaging.chatTitleFallback")}</h1>
      <p className="text-muted">
        {conversation.type} | {t("groups.membersTitle").toLowerCase()} {conversation.members.length} | {t("messaging.defaultTtl")}{" "}
        {conversation.disappearingPolicy.defaultTtlSeconds || 0}s
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <p>
          <strong>{t("home.transport")}:</strong> {transport.mode} / {transport.status}
        </p>
        <p className="text-muted">Endpoint: {transport.endpoint ?? "-"}</p>
        {transport.lastError ? <p className="error-text">{transport.lastError}</p> : null}
        <p className="text-muted">
          {t("nav.outbox")}: {conversationOutbox.length}
        </p>
      </div>

      <form className="card form-grid" onSubmit={handleSend}>
        <label>
          {t("messaging.messageLabel")}
          <textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={4} placeholder={t("messaging.messagePlaceholder")} />
        </label>
        <label>
          {t("messaging.ttlLabel")}
          <input value={ttlInput} onChange={(event) => setTTLInput(event.target.value)} placeholder={t("messaging.ttlPlaceholder")} />
        </label>
        <label>
          {t("messaging.attachments")}
          <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        </label>
        {files.length > 0 ? (
          <p className="text-muted">
            {t("messaging.selected")}: {files.map((file) => file.name).join(", ")}
          </p>
        ) : null}
        <button type="submit" disabled={sending || !session || !messageText.trim()}>
          {sending ? t("messaging.sending") : t("messaging.send")}
        </button>
      </form>

      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => void messagingRuntime.retryOutbox()}>
          {t("messaging.retryQueue")}
        </button>
        <button type="button" onClick={() => void messagingRuntime.loadMessages(conversation.id)}>
          {t("messaging.reloadHistory")}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <section style={{ marginTop: 20 }}>
        <h2>{t("messaging.messageLabel")}</h2>
        {loadingMessages ? <p className="text-muted">{t("messaging.loadingHistory")}</p> : null}
        {!loadingMessages && sortedMessages.length === 0 ? <p className="text-muted">{t("messaging.noMessages")}</p> : null}

        {sortedMessages.map((message) => {
          const senderTag = message.envelope.senderDeviceId === session?.device.id ? "me" : message.envelope.senderAccountId.slice(0, 8);
          const isExpired = message.envelope.expiresAt ? new Date(message.envelope.expiresAt).getTime() <= clock : false;
          const statusLabel = t(`messaging.status.${message.lifecycle}` as const);
          return (
            <article className="list-item message-item" key={`${message.envelope.id}-${message.envelope.senderDeviceId}`}>
              <p>
                <strong>{senderTag}</strong> | seq {message.envelope.serverSequence || "local"} | {t("common.status")}{" "}
                <span className={`status-chip status-${message.lifecycle}`}>{statusLabel}</span>
              </p>
              <p className="text-muted">{message.envelope.createdAt}</p>

              {isExpired ? <p className="text-muted">[{t("messaging.expired")}]</p> : null}
              {!isExpired && message.plaintext?.text ? <p>{message.plaintext.text}</p> : null}
              {!isExpired && !message.plaintext?.text ? <p className="text-muted">{message.decryptError || `[${t("messaging.encryptedContent")}]`}</p> : null}

              {message.failureCode ? (
                <p className="error-text">
                  {t("messaging.failure")}: {message.failureCode}
                </p>
              ) : null}

              {!isExpired && message.plaintext?.attachments && message.plaintext.attachments.length > 0 ? (
                <div className="inline-actions">
                  {message.plaintext.attachments.map((attachment) => (
                    <button
                      key={attachment.attachmentId}
                      type="button"
                      disabled={Boolean(downloadingByAttachment[attachment.attachmentId])}
                      onClick={() => void handleDownloadAttachment(attachment)}
                    >
                      {downloadingByAttachment[attachment.attachmentId]
                        ? t("messaging.downloading")
                        : `${t("messaging.download")} ${attachment.fileName}`}
                    </button>
                  ))}
                </div>
              ) : null}

              {message.receipts.length > 0 ? (
                <p className="text-muted">
                  {t("messaging.receipts")}: {message.receipts.map((receipt) => `${receipt.receiptType}@${receipt.deviceId.slice(0, 6)}`).join(", ")}
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </section>
  );
}

