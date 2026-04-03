import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { MessengerShell } from "@/features/messaging/MessengerShell";
import { useAuthStore } from "@/state/authStore";

export function ConversationListPage() {
  const { t } = useTranslation();
  const session = useAuthStore((state) => state.session);
  const [copied, setCopied] = useState(false);

  async function copyAccountId() {
    if (!session?.accountId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(session.accountId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <MessengerShell>
      <article className="card messenger-empty-state">
        <h2>{t("messaging.startConversationTitle")}</h2>
        <p className="text-muted">{t("messaging.startConversationSubtitle")}</p>

        <div className="messenger-empty-actions">
          <Link className="button-link" to="/friends">
            {t("nav.friends")}
          </Link>
          <Link className="button-link" to="/devices">
            {t("nav.devices")}
          </Link>
          <Link className="button-link" to="/settings">
            {t("nav.settings")}
          </Link>
        </div>

        {session?.accountId ? (
          <div className="account-share-card">
            <div>
              <p className="text-muted">{t("devices.accountIdLabel")}</p>
              <code className="account-share-code">{session.accountId}</code>
            </div>
            <button type="button" className="button-ghost" onClick={() => void copyAccountId()}>
              {copied ? t("common.copied") : t("devices.copyAccountId")}
            </button>
          </div>
        ) : null}
      </article>
    </MessengerShell>
  );
}
