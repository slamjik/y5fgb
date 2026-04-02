import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { appConfig } from "@/lib/config";
import { getActiveServerConfig } from "@/services/serverConnection";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";

export function HomePage() {
  const { t } = useTranslation();
  const initialized = useAppStore((state) => state.initialized);
  const lastInitAt = useAppStore((state) => state.lastInitAt);
  const session = useAuthStore((state) => state.session);
  const transport = useMessagingStore((state) => state.transport);
  const conversationsCount = useMessagingStore((state) => state.conversations.length);
  const activeServer = getActiveServerConfig();

  return (
    <section className="page-stack">
      <h1>{t("home.title")}</h1>
      <p className="text-muted">{t("home.subtitle")}</p>

      <div className="card-grid">
        <article className="card">
          <h2>{t("home.environment")}</h2>
          <p>{appConfig.environment}</p>
          <p className="text-muted">API: {`${activeServer.apiBaseUrl}${activeServer.apiPrefix}`}</p>
        </article>

        <article className="card">
          <h2>{t("home.appBootstrap")}</h2>
          <p>{initialized ? t("home.ready") : t("home.bootstrapping")}</p>
          <p className="text-muted">{lastInitAt ?? "-"}</p>
        </article>

        <article className="card">
          <h2>{t("home.sessionMessaging")}</h2>
          {session ? (
            <>
              <p>
                {t("home.account")}: {session.accountId}
              </p>
              <p>
                {t("home.email")}: {session.email || "-"}
              </p>
              <p>
                {t("home.twoFA")}: {session.twoFactorEnabled ? t("home.enabled") : t("home.disabled")}
              </p>
              <p>
                {t("home.conversations")}: {conversationsCount}
              </p>
              <p>
                {t("home.transport")}: {transport.mode} / {transport.status}
              </p>
              {session.session.trustWarnings && session.session.trustWarnings.length > 0 ? (
                <p className="error-text">
                  {t("home.trustWarnings")}: {session.session.trustWarnings.join(", ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted">{t("home.notAuthenticated")}</p>
          )}
        </article>
      </div>

      <div className="inline-actions section-offset-sm">
        <Link className="button-link" to="/">
          {t("nav.conversations")}
        </Link>
        <Link className="button-link" to="/messaging/outbox">
          {t("nav.outbox")}
        </Link>
        <Link className="button-link" to="/devices">
          {t("nav.devices")}
        </Link>
        <Link className="button-link" to="/security-events">
          {t("nav.securityEvents")}
        </Link>
      </div>
    </section>
  );
}
