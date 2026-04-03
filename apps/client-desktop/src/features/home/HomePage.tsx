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
  const profileTrust = session?.session.trustWarnings?.length ? "warning" : "trusted";
  const transportStatusClass = transport.status === "offline" ? "offline" : transport.status;

  return (
    <section className="page-stack">
      <article className="card home-hero-card">
        <div className="home-hero-main">
          <h1>{t("home.title")}</h1>
          <p className="text-muted">{t("home.subtitle")}</p>
        </div>
        <div className="home-hero-badges">
          <span className={`status-chip status-${transportStatusClass}`}>
            {t("home.transport")}: {transport.mode} / {transport.status}
          </span>
          <span className={`status-chip status-${profileTrust}`}>{t("securityEvents.trustState")}: {profileTrust}</span>
        </div>
      </article>

      <div className="card-grid home-stats-grid">
        <article className="card home-stat-card">
          <h2>{t("home.environment")}</h2>
          <p>{appConfig.environment}</p>
          <p className="text-muted">API: {`${activeServer.apiBaseUrl}${activeServer.apiPrefix}`}</p>
        </article>

        <article className="card home-stat-card">
          <h2>{t("home.appBootstrap")}</h2>
          <p>{initialized ? t("home.ready") : t("home.bootstrapping")}</p>
          <p className="text-muted">{lastInitAt ?? "-"}</p>
        </article>

        <article className="card home-stat-card">
          <h2>{t("home.sessionMessaging")}</h2>
          {session ? (
            <div className="home-kpi-list">
              <div className="home-kpi-row">
                <span className="text-muted">{t("home.account")}</span>
                <span>{session.accountId.slice(0, 14)}...</span>
              </div>
              <div className="home-kpi-row">
                <span className="text-muted">{t("home.email")}</span>
                <span>{session.email || "-"}</span>
              </div>
              <div className="home-kpi-row">
                <span className="text-muted">{t("home.twoFA")}</span>
                <span>{session.twoFactorEnabled ? t("home.enabled") : t("home.disabled")}</span>
              </div>
              <div className="home-kpi-row">
                <span className="text-muted">{t("home.conversations")}</span>
                <span>{conversationsCount}</span>
              </div>
              <div className="home-kpi-row">
                <span className="text-muted">{t("home.transport")}</span>
                <span>{transport.mode} / {transport.status}</span>
              </div>
              {session.session.trustWarnings && session.session.trustWarnings.length > 0 ? (
                <p className="error-text">
                  {t("home.trustWarnings")}: {session.session.trustWarnings.join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted">{t("home.notAuthenticated")}</p>
          )}
        </article>
      </div>

      <div className="inline-actions section-offset-sm home-quick-actions">
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
