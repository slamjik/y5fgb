import { FormEvent, ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";

type ComposerMode = "direct" | "group" | null;

interface MessengerShellProps {
  activeConversationId?: string | null;
  children: ReactNode;
}

interface ConversationPreview {
  id: string;
  type: "direct" | "group";
  title: string;
  updatedAt: string;
  membersCount: number;
  defaultTtlSeconds: number;
  lastText: string;
  lastAt: string;
  unreadCount: number;
}

export function MessengerShell({ activeConversationId = null, children }: MessengerShellProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const initialized = useMessagingStore((state) => state.initialized);
  const loading = useMessagingStore((state) => state.loading);
  const conversations = useMessagingStore((state) => state.conversations);
  const messagesByConversation = useMessagingStore((state) => state.messagesByConversation);
  const readPositions = useMessagingStore((state) => state.readPositions);
  const outbox = useMessagingStore((state) => state.outbox);
  const transport = useMessagingStore((state) => state.transport);
  const session = useAuthStore((state) => state.session);

  const [search, setSearch] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [directAccountId, setDirectAccountId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language],
  );

  const previews = useMemo<ConversationPreview[]>(() => {
    const sessionDeviceId = session?.device.id;
    return [...conversations]
      .map((conversation) => {
        const sortedMessages = [...(messagesByConversation[conversation.id] ?? [])].sort(
          (left, right) => left.envelope.serverSequence - right.envelope.serverSequence,
        );
        const lastMessage = sortedMessages[sortedMessages.length - 1];
        const readSequence = readPositions[conversation.id] ?? 0;
        const unreadCount = sortedMessages.filter(
          (message) =>
            message.envelope.serverSequence > readSequence &&
            message.envelope.senderDeviceId !== sessionDeviceId &&
            !message.expired,
        ).length;

        const fallbackTitle = `${t("messaging.chatTitleFallback")} ${conversation.id.slice(0, 8)}`;
        return {
          id: conversation.id,
          type: conversation.type,
          title: conversation.title || fallbackTitle,
          updatedAt: conversation.updatedAt,
          membersCount: conversation.members.length,
          defaultTtlSeconds: conversation.disappearingPolicy.defaultTtlSeconds || 0,
          lastText: lastMessage?.plaintext?.text?.trim() || t("messaging.noPreview"),
          lastAt: lastMessage?.envelope.createdAt || conversation.updatedAt,
          unreadCount,
        };
      })
      .sort((left, right) => {
        if (left.lastAt > right.lastAt) {
          return -1;
        }
        if (left.lastAt < right.lastAt) {
          return 1;
        }
        return 0;
      });
  }, [conversations, messagesByConversation, readPositions, session?.device.id, t]);

  const filteredPreviews = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return previews;
    }
    return previews.filter((conversation) => {
      return conversation.title.toLowerCase().includes(normalized) || conversation.lastText.toLowerCase().includes(normalized);
    });
  }, [previews, search]);

  const canCreateConversation = initialized && !loading && !working;

  function openConversation(conversationId: string) {
    navigate(`/conversations/${conversationId}`);
  }

  async function handleCreateDirect(event: FormEvent) {
    event.preventDefault();
    if (!directAccountId.trim()) {
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const conversation = await messagingRuntime.createDirect(directAccountId.trim());
      setDirectAccountId("");
      setComposerMode(null);
      navigate(`/conversations/${conversation.id}`);
    } catch (createError) {
      setError(extractApiErrorMessage(createError));
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupTitle.trim()) {
      return;
    }

    const memberIds = groupMembers
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    setWorking(true);
    setError(null);
    try {
      const conversation = await messagingRuntime.createGroup(groupTitle.trim(), memberIds);
      setGroupTitle("");
      setGroupMembers("");
      setComposerMode(null);
      navigate(`/conversations/${conversation.id}`);
    } catch (createError) {
      setError(extractApiErrorMessage(createError));
    } finally {
      setWorking(false);
    }
  }

  function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }
    return dateFormatter.format(date);
  }

  return (
    <section className="messenger-layout">
      <aside className="messenger-list-pane card">
        <header className="messenger-list-header">
          <div>
            <h1>{t("messaging.conversationsTitle")}</h1>
            <p className="text-muted">{t("messaging.conversationsSubtitle")}</p>
          </div>
          <div className="messenger-create-actions">
            <button type="button" className="button-ghost" onClick={() => setComposerMode(composerMode === "direct" ? null : "direct")}>
              {t("messaging.newDirect")}
            </button>
            <button type="button" className="button-ghost" onClick={() => setComposerMode(composerMode === "group" ? null : "group")}>
              {t("messaging.newGroup")}
            </button>
          </div>
        </header>

        <label className="search-input">
          <span className="text-muted">{t("messaging.searchChats")}</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("messaging.searchPlaceholder")} />
        </label>

        {composerMode === "direct" ? (
          <form className="messenger-creator form-grid" onSubmit={handleCreateDirect}>
            <label>
              {t("messaging.peerAccountId")}
              <input value={directAccountId} onChange={(event) => setDirectAccountId(event.target.value)} placeholder="account uuid" />
            </label>
            <button type="submit" disabled={!canCreateConversation || !directAccountId.trim()}>
              {t("messaging.createDirectAction")}
            </button>
          </form>
        ) : null}

        {composerMode === "group" ? (
          <form className="messenger-creator form-grid" onSubmit={handleCreateGroup}>
            <label>
              {t("messaging.groupTitle")}
              <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Team Security" />
            </label>
            <label>
              {t("messaging.groupMembers")}
              <textarea value={groupMembers} onChange={(event) => setGroupMembers(event.target.value)} rows={2} placeholder="uuid-1, uuid-2" />
            </label>
            <button type="submit" disabled={!canCreateConversation || !groupTitle.trim()}>
              {t("messaging.createGroupAction")}
            </button>
          </form>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}

        <div className="messenger-conversation-list">
          {loading ? <p className="state-message">{t("messaging.loadingConversations")}</p> : null}
          {!loading && filteredPreviews.length === 0 ? <p className="state-message">{t("messaging.noConversations")}</p> : null}

          {filteredPreviews.map((conversation) => {
            const isActive = activeConversationId === conversation.id;
            const avatarText = conversation.type === "group" ? "#" : conversation.title.slice(0, 1).toUpperCase();
            return (
              <button
                key={conversation.id}
                type="button"
                className={`conversation-row ${isActive ? "active" : ""}`}
                onClick={() => openConversation(conversation.id)}
              >
                <span className={`conversation-avatar ${conversation.type === "group" ? "group" : "direct"}`}>{avatarText}</span>
                <span className="conversation-main">
                  <span className="conversation-topline">
                    <strong>{conversation.title}</strong>
                    <span className="conversation-time">{formatTime(conversation.lastAt)}</span>
                  </span>
                  <span className="conversation-subline">
                    <span className="conversation-preview">{conversation.lastText}</span>
                    {conversation.unreadCount > 0 ? <span className="unread-pill">{conversation.unreadCount}</span> : null}
                  </span>
                  <span className="conversation-meta-row text-muted">
                    {conversation.type === "group" ? t("messaging.messageTypeGroup") : t("messaging.messageTypeDirect")} · {t("groups.membersTitle")}: {conversation.membersCount} · TTL {conversation.defaultTtlSeconds}s
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <footer className="messenger-list-footer">
          <div>
            <strong>{t("home.transport")}</strong>: {transport.mode} / {transport.status}
          </div>
          <div className="text-muted">{t("nav.outbox")}: {outbox.length}</div>
          {transport.lastError ? <p className="error-text">{transport.lastError}</p> : null}
          <Link className="button-link" to="/messaging/transport">
            {t("settings.transportHealth")}
          </Link>
        </footer>
      </aside>

      <div className="messenger-content-pane">{children}</div>
    </section>
  );
}
