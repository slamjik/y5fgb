import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingApi } from "@/services/messaging/messagingApi";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";

export function GroupMembersPage() {
  const { t } = useTranslation();
  const { conversationId = "" } = useParams();
  const accessToken = useAuthStore((state) => state.accessToken);
  const conversation = useMessagingStore((state) => state.conversations.find((item) => item.id === conversationId) ?? null);
  const upsertConversation = useMessagingStore((state) => state.upsertConversation);

  const [memberAccountId, setMemberAccountId] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !accessToken || !memberAccountId.trim()) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await messagingApi.addMember(accessToken, conversation.id, {
        memberAccountId: memberAccountId.trim(),
        role,
      });
      upsertConversation(response.conversation);
      setMemberAccountId("");
    } catch (submitError) {
      setError(extractApiErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (!conversation || conversation.type !== "group") {
    return (
      <section className="page-stack">
        <h1>{t("groups.membersTitle")}</h1>
        <p className="text-muted">{t("errors.codes.conversation_not_found")}</p>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <h1>{t("groups.membersTitle")}</h1>
      <p className="text-muted">{conversation.title || conversation.id}</p>

      <form className="card form-grid" onSubmit={submit}>
        <label>
          {t("groups.accountId")}
          <input value={memberAccountId} onChange={(event) => setMemberAccountId(event.target.value)} />
        </label>
        <label>
          {t("groups.role")}
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="member">{t("groups.member")}</option>
            <option value="admin">{t("groups.admin")}</option>
          </select>
        </label>
        <button type="submit" disabled={submitting || !memberAccountId.trim()}>
          {submitting ? t("common.loading") : t("groups.addMember")}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="section-offset-sm">
        {conversation.members.length === 0 ? <p className="text-muted">{t("groups.noMembers")}</p> : null}
        {conversation.members.map((member) => (
          <article className="list-item" key={member.accountId}>
            <p>
              <strong>{member.accountId}</strong> | {member.role} | {member.isActive ? t("home.enabled") : t("home.disabled")}
            </p>
            <p className="text-muted">
              {t("groups.trustedDevices")}: {member.trustedDevices.length}
            </p>
          </article>
        ))}
      </section>
    </section>
  );
}
