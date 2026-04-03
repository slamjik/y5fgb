import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { MessengerShell } from "@/features/messaging/MessengerShell";
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

const QUICK_REACTIONS = ["👍", "🔥", "❤️", "😂"] as const;

interface ReplyDraft {
  messageId: string;
  senderLabel: string;
  preview: string;
}

export function ConversationPage() {
  const { t, i18n } = useTranslation();
  const { conversationId = "" } = useParams();

  const session = useAuthStore((state) => state.session);
  const conversation = useMessagingStore((state) => state.conversations.find((item) => item.id === conversationId) ?? null);
  const messages = useMessagingStore((state) => state.messagesByConversation[conversationId] ?? []);
  const outbox = useMessagingStore((state) => state.outbox);
  const transport = useMessagingStore((state) => state.transport);
  const markConversationRead = useMessagingStore((state) => state.markConversationRead);

  const [messageText, setMessageText] = useState("");
  const [ttlInput, setTTLInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [clock, setClock] = useState(Date.now());
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  const [hiddenMessages, setHiddenMessages] = useState<Record<string, true>>({});
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, true>>>({});
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

  useEffect(() => {
    const lastSequence = sortedMessages[sortedMessages.length - 1]?.envelope.serverSequence;
    if (typeof lastSequence === "number" && Number.isFinite(lastSequence) && lastSequence > 0 && conversationId) {
      markConversationRead(conversationId, lastSequence);
    }
  }, [conversationId, markConversationRead, sortedMessages]);

  const messageById = useMemo(() => {
    const index = new Map<string, LocalMessage>();
    for (const message of sortedMessages) {
      index.set(message.envelope.id, message);
    }
    return index;
  }, [sortedMessages]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "en-US", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  const conversationOutbox = useMemo(() => outbox.filter((item) => item.conversationId === conversationId), [conversationId, outbox]);

  const visibleMessages = useMemo(
    () => sortedMessages.filter((message) => !hiddenMessages[message.envelope.id]),
    [hiddenMessages, sortedMessages],
  );

  function formatTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return dateFormatter.format(date);
  }

  function setReaction(messageId: string, emoji: string) {
    setLocalReactions((state) => {
      const current = state[messageId] ?? {};
      if (current[emoji]) {
        const { [emoji]: _removed, ...nextCurrent } = current;
        return {
          ...state,
          [messageId]: nextCurrent,
        };
      }
      return {
        ...state,
        [messageId]: {
          ...current,
          [emoji]: true,
        },
      };
    });
  }

  function hideMessage(messageId: string) {
    setHiddenMessages((state) => ({
      ...state,
      [messageId]: true,
    }));
  }

  function prepareReply(message: LocalMessage) {
    const senderLabel =
      message.envelope.senderDeviceId === session?.device.id
        ? t("messaging.senderMe")
        : message.envelope.senderAccountId.slice(0, 8);
    setReplyDraft({
      messageId: message.envelope.id,
      senderLabel,
      preview: message.plaintext?.text?.slice(0, 120) || t("messaging.encryptedContent"),
    });
  }

  function prepareEditAsNew(message: LocalMessage) {
    const next = message.plaintext?.text ?? "";
    if (!next) {
      return;
    }
    setMessageText(next);
  }

  async function copyMessage(message: LocalMessage) {
    const text = message.plaintext?.text;
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (copyError) {
      setError(extractApiErrorMessage(copyError));
    }
  }

  async function sendCurrentMessage() {
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
        replyToMessageId: replyDraft?.messageId,
      });
      setMessageText("");
      setTTLInput("");
      setFiles([]);
      setReplyDraft(null);
    } catch (sendError) {
      setError(extractApiErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  }

  function handleSend(event: FormEvent) {
    event.preventDefault();
    void sendCurrentMessage();
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sending && messageText.trim()) {
        void sendCurrentMessage();
      }
    }
  }

  if (!conversation) {
    return (
      <MessengerShell activeConversationId={null}>
        <article className="card messenger-empty-state">
          <h2>{t("messaging.conversationNotFound")}</h2>
          <p className="text-muted">{t("messaging.openAnotherConversation")}</p>
        </article>
      </MessengerShell>
    );
  }

  const conversationKindLabel = conversation.type === "group" ? t("messaging.messageTypeGroup") : t("messaging.messageTypeDirect");

  return (
    <MessengerShell activeConversationId={conversation.id}>
      <div className="chat-workspace">
        <div className="chat-main-column">
          <header className="chat-header card">
            <div>
              <h2>{conversation.title || t("messaging.chatTitleFallback")}</h2>
              <p className="text-muted">
                {conversationKindLabel} · {t("groups.membersTitle")}: {conversation.members.length} · {t("messaging.defaultTtl")} {conversation.disappearingPolicy.defaultTtlSeconds || 0}s
              </p>
            </div>
            <div className="chat-header-state">
              <span className={`status-chip status-${transport.status === "offline" ? "failed" : transport.status === "degraded" ? "queued" : "delivered"}`}>
                {transport.status}
              </span>
              <span className="text-muted">{transport.mode}</span>
              {conversation.type === "group" ? (
                <Link className="button-link" to={`/conversations/${conversation.id}/members`}>
                  {t("messaging.members")}
                </Link>
              ) : null}
            </div>
          </header>

          {error ? <p className="error-text">{error}</p> : null}

          <section className="messages-feed card">
            {loadingMessages ? <p className="state-message">{t("messaging.loadingHistory")}</p> : null}
            {!loadingMessages && visibleMessages.length === 0 ? <p className="state-message">{t("messaging.noMessages")}</p> : null}

            {visibleMessages.map((message) => {
              const isMine = message.envelope.senderDeviceId === session?.device.id;
              const senderTag = isMine ? t("messaging.senderMe") : message.envelope.senderAccountId.slice(0, 8);
              const isExpired = message.envelope.expiresAt ? new Date(message.envelope.expiresAt).getTime() <= clock : false;
              const statusLabel = t(`messaging.status.${message.lifecycle}` as const);
              const hasPreview = Boolean(message.plaintext?.text);
              const timeToExpireSec = message.envelope.expiresAt
                ? Math.max(0, Math.floor((new Date(message.envelope.expiresAt).getTime() - clock) / 1000))
                : null;

              const reactionSet = localReactions[message.envelope.id] ?? {};
              const replySource = message.envelope.replyToMessageId ? messageById.get(message.envelope.replyToMessageId) : null;

              return (
                <article className={`message-row ${isMine ? "mine" : "theirs"}`} key={`${message.envelope.id}-${message.envelope.senderDeviceId}`}>
                  <span className="message-avatar" aria-hidden="true">
                    {senderTag.slice(0, 1).toUpperCase()}
                  </span>

                  <div className="message-bubble">
                    <div className="message-topline">
                      <strong>{senderTag}</strong>
                      <span className="message-meta">{formatTimestamp(message.envelope.createdAt)}</span>
                      <span className={`status-chip status-${message.lifecycle}`}>{statusLabel}</span>
                    </div>

                    {replySource ? (
                      <div className="reply-preview-block">
                        <span className="text-muted">
                          {t("messaging.replyTo")}: {replySource.envelope.senderAccountId.slice(0, 8)}
                        </span>
                        <p>{replySource.plaintext?.text || t("messaging.encryptedContent")}</p>
                      </div>
                    ) : null}

                    {isExpired ? <p className="message-text text-muted">[{t("messaging.expired")}]</p> : null}
                    {!isExpired && hasPreview ? <p className="message-text">{message.plaintext?.text}</p> : null}
                    {!isExpired && !hasPreview ? (
                      <p className="message-text text-muted">{message.decryptError || `[${t("messaging.encryptedContent")}]`}</p>
                    ) : null}

                    {!isExpired && timeToExpireSec !== null ? <p className="message-meta">TTL: {timeToExpireSec}s</p> : null}

                    {message.failureCode ? (
                      <p className="error-text">
                        {t("messaging.failure")}: {message.failureCode}
                      </p>
                    ) : null}

                    {!isExpired && message.plaintext?.attachments && message.plaintext.attachments.length > 0 ? (
                      <div className="attachment-list">
                        {message.plaintext.attachments.map((attachment) => (
                          <button
                            key={attachment.attachmentId}
                            type="button"
                            className="button-ghost"
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

                    <div className="reaction-row">
                      {Object.keys(reactionSet).map((emoji) => (
                        <button key={emoji} type="button" className="reaction-pill active" onClick={() => setReaction(message.envelope.id, emoji)}>
                          {emoji}
                        </button>
                      ))}
                      {QUICK_REACTIONS.map((emoji) => (
                        <button key={emoji} type="button" className="reaction-pill" onClick={() => setReaction(message.envelope.id, emoji)}>
                          {emoji}
                        </button>
                      ))}
                    </div>

                    <div className="message-actions-row">
                      <button type="button" className="button-link subtle" onClick={() => prepareReply(message)}>
                        {t("messaging.reply")}
                      </button>
                      <button type="button" className="button-link subtle" onClick={() => void copyMessage(message)}>
                        {t("messaging.copy")}
                      </button>
                      <button type="button" className="button-link subtle" onClick={() => prepareEditAsNew(message)}>
                        {t("messaging.editAsNew")}
                      </button>
                      {isMine && message.lifecycle === "failed" ? (
                        <button type="button" className="button-link subtle" onClick={() => void messagingRuntime.retryOutbox()}>
                          {t("messaging.retry")}
                        </button>
                      ) : null}
                      <button type="button" className="button-link subtle" onClick={() => hideMessage(message.envelope.id)}>
                        {t("messaging.deleteLocal")}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <form className="chat-composer card" onSubmit={handleSend}>
            {replyDraft ? (
              <div className="composer-reply-banner">
                <div>
                  <strong>{t("messaging.replyTo")}: {replyDraft.senderLabel}</strong>
                  <p className="text-muted">{replyDraft.preview}</p>
                </div>
                <button type="button" className="button-ghost" onClick={() => setReplyDraft(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            ) : null}

            <label>
              {t("messaging.messageLabel")}
              <textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={4}
                placeholder={t("messaging.messagePlaceholder")}
              />
            </label>

            <div className="composer-toolbar">
              <label>
                {t("messaging.ttlLabel")}
                <input value={ttlInput} onChange={(event) => setTTLInput(event.target.value)} placeholder={t("messaging.ttlPlaceholder")} />
              </label>

              <label>
                {t("messaging.attachments")}
                <input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
              </label>

              <div className="emoji-shortcuts">
                {QUICK_REACTIONS.map((emoji) => (
                  <button key={emoji} type="button" className="button-ghost" onClick={() => setMessageText((current) => `${current}${emoji}`)}>
                    {emoji}
                  </button>
                ))}
              </div>

              <button type="submit" disabled={sending || !session || !messageText.trim()}>
                {sending ? t("messaging.sending") : t("messaging.send")}
              </button>
            </div>

            {files.length > 0 ? (
              <p className="text-muted">
                {t("messaging.selected")}: {files.map((file) => file.name).join(", ")}
              </p>
            ) : null}
          </form>
        </div>

        <aside className="chat-side-column card">
          <h3>{conversation.type === "group" ? t("groups.membersTitle") : t("friends.myProfile")}</h3>
          <p className="text-muted">
            {t("common.status")}: {transport.status} · {t("nav.outbox")}: {conversationOutbox.length}
          </p>
          <p className="text-muted">{t("common.endpoint")}: {transport.endpoint ?? "-"}</p>

          {conversation.type === "group" ? (
            <div className="member-list-grid">
              {conversation.members.map((member) => (
                <article className="member-row" key={member.accountId}>
                  <span className="member-avatar">{member.accountId.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <p>
                      <strong>{member.accountId.slice(0, 10)}</strong>
                    </p>
                    <p className="text-muted">{member.role} · {member.isActive ? t("home.enabled") : t("home.disabled")}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="member-list-grid">
              <article className="member-row">
                <span className="member-avatar">{conversation.members[0]?.accountId.slice(0, 1).toUpperCase() || "?"}</span>
                <div>
                  <p>
                    <strong>{conversation.members[0]?.accountId.slice(0, 16) || "-"}</strong>
                  </p>
                  <p className="text-muted">{t("messaging.messageTypeDirect")}</p>
                </div>
              </article>
            </div>
          )}
        </aside>
      </div>
    </MessengerShell>
  );
}
