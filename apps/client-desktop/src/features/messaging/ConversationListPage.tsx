import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { MessengerShell } from "@/features/messaging/MessengerShell";
import { useAuthStore } from "@/state/authStore";

export function ConversationListPage() {
  const { t } = useTranslation();
  const session = useAuthStore((state) => state.session);

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

        <div className="inline-code-wrap">
          <span className="inline-code">{t("devices.accountIdLabel")}: {session?.accountId ?? "-"}</span>
        </div>
      </article>
    </MessengerShell>
  );
}
