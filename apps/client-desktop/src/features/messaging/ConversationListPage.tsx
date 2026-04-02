import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useMessagingStore } from "@/state/messagingStore";

export function ConversationListPage() {
  const { t } = useTranslation();
  const loading = useMessagingStore((state) => state.loading);
  const conversations = useMessagingStore((state) => state.conversations);
  const transport = useMessagingStore((state) => state.transport);
  const outbox = useMessagingStore((state) => state.outbox);

  const [directAccountId, setDirectAccountId] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((left, right) => {
        if (left.updatedAt > right.updatedAt) {
          return -1;
        }
        if (left.updatedAt < right.updatedAt) {
          return 1;
        }
        return 0;
      }),
    [conversations],
  );

  async function handleCreateDirect(event: FormEvent) {
    event.preventDefault();
    if (!directAccountId.trim()) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await messagingRuntime.createDirect(directAccountId.trim());
      setDirectAccountId("");
    } catch (createError) {
      setError(extractApiErrorMessage(createError));
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    const memberIds = groupMembers
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!groupTitle.trim()) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await messagingRuntime.createGroup(groupTitle.trim(), memberIds);
      setGroupTitle("");
      setGroupMembers("");
    } catch (createError) {
      setError(extractApiErrorMessage(createError));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section>
      <h1>{t("messaging.conversationsTitle")}</h1>
      <p className="text-muted">{t("messaging.conversationsSubtitle")}</p>

      <div className="card-grid">
        <article className="card">
          <h2>{t("messaging.createDirect")}</h2>
          <form className="form-grid" onSubmit={handleCreateDirect}>
            <label>
              {t("messaging.peerAccountId")}
              <input value={directAccountId} onChange={(event) => setDirectAccountId(event.target.value)} placeholder="account uuid" />
            </label>
            <button type="submit" disabled={working || !directAccountId.trim()}>
              {t("messaging.createDirectAction")}
            </button>
          </form>
        </article>

        <article className="card">
          <h2>{t("messaging.createGroup")}</h2>
          <form className="form-grid" onSubmit={handleCreateGroup}>
            <label>
              {t("messaging.groupTitle")}
              <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Team Security" />
            </label>
            <label>
              {t("messaging.groupMembers")}
              <textarea
                value={groupMembers}
                onChange={(event) => setGroupMembers(event.target.value)}
                rows={3}
                placeholder="uuid-1, uuid-2"
              />
            </label>
            <button type="submit" disabled={working || !groupTitle.trim()}>
              {t("messaging.createGroupAction")}
            </button>
          </form>
        </article>

        <article className="card">
          <h2>{t("nav.transport")}</h2>
          <p>
            <strong>Mode:</strong> {transport.mode}
          </p>
          <p>
            <strong>{t("common.status")}:</strong> {transport.status}
          </p>
          <p className="text-muted">{transport.endpoint ?? "-"}</p>
          {transport.lastError ? <p className="error-text">{transport.lastError}</p> : null}
          <div className="inline-actions" style={{ marginTop: 12 }}>
            <Link className="button-link" to="/messaging/transport">
              {t("settings.transportHealth")}
            </Link>
            <Link className="button-link" to="/messaging/outbox">
              {t("nav.outbox")} ({outbox.length})
            </Link>
          </div>
        </article>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <section style={{ marginTop: 20 }}>
        <h2>{t("messaging.listTitle")}</h2>
        {loading ? <p className="text-muted">{t("messaging.loadingConversations")}</p> : null}

        {!loading && sortedConversations.length === 0 ? (
          <p className="text-muted">{t("messaging.noConversations")}</p>
        ) : (
          <div>
            {sortedConversations.map((conversation) => (
              <article className="list-item" key={conversation.id}>
                <p>
                  <strong>{conversation.title || `${t("messaging.chatTitleFallback")} ${conversation.id.slice(0, 8)}`}</strong>
                </p>
                <p className="text-muted">
                  {conversation.type} | {t("groups.membersTitle").toLowerCase()} {conversation.members.length} | {t("messaging.defaultTtl")}{" "}
                  {conversation.disappearingPolicy.defaultTtlSeconds || 0}s
                </p>
                <div className="inline-actions">
                  <Link className="button-link" to={`/conversations/${conversation.id}`}>
                    {t("messaging.openChat")}
                  </Link>
                  {conversation.type === "group" ? (
                    <Link className="button-link" to={`/conversations/${conversation.id}/members`}>
                      {t("messaging.members")}
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

