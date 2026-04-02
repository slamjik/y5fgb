import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { appConfig } from "@/lib/config";
import { clearSession } from "@/services/authSession";
import { type AppLanguage, changeLanguage } from "@/services/i18n";
import { messagingRuntime } from "@/services/messaging/runtime";
import { clearServerConfig, getActiveServerConfig, getServerHostForDisplay } from "@/services/serverConnection";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((state) => state.setOnboardingCompleted);
  const activeServer = getActiveServerConfig();

  async function handleChangeServer() {
    await clearSession();
    messagingRuntime.stop();
    useMessagingStore.getState().reset();
    clearServerConfig();
    setOnboardingCompleted(false);
    navigate("/connect-server", { replace: true });
  }

  function onLanguageChange(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    changeLanguage(nextLanguage);
  }

  return (
    <section>
      <h1>{t("settings.title")}</h1>
      <p className="text-muted">{t("settings.subtitle")}</p>

      <div className="card-grid">
        <article className="card">
          <h2>{t("settings.language")}</h2>
          <label>
            {t("settings.language")}
            <select value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="text-muted">{t("settings.languageHelp")}</p>
        </article>

        <article className="card">
          <h2>{t("settings.networkTitle")}</h2>
          <p>
            <strong>{t("settings.serverHost")}:</strong> {getServerHostForDisplay(activeServer)}
          </p>
          <p>
            <strong>{t("settings.serverSource")}:</strong>{" "}
            {activeServer.source === "saved" ? t("settings.serverSourceSaved") : t("settings.serverSourceEnv")}
          </p>
          <p>
            <strong>{t("settings.apiBase")}:</strong> {activeServer.apiBaseUrl}
          </p>
          <p>
            <strong>{t("settings.wsBase")}:</strong> {activeServer.wsUrl}
          </p>
          <p>
            <strong>{t("settings.apiPrefix")}:</strong> {activeServer.apiPrefix}
          </p>
          <p>
            <strong>{t("settings.wsQueryFallback")}:</strong> {String(appConfig.wsQueryTokenFallback)}
          </p>
          <p>
            <strong>{t("settings.transportOverrides")}:</strong>{" "}
            {appConfig.transportEndpointOverrides.length > 0
              ? appConfig.transportEndpointOverrides.join(", ")
              : t("common.none")}
          </p>
          <div className="inline-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void handleChangeServer()}>
              {t("settings.changeServer")}
            </button>
          </div>
          <p className="text-muted">{t("settings.changeServerHelp")}</p>
        </article>

        <article className="card">
          <h2>{t("settings.linksTitle")}</h2>
          <div className="inline-actions">
            <Link className="button-link" to="/devices">
              {t("settings.accountDevices")}
            </Link>
            <Link className="button-link" to="/plugins">
              {t("settings.pluginManager")}
            </Link>
            <Link className="button-link" to="/messaging/transport">
              {t("settings.transportHealth")}
            </Link>
            <Link className="button-link" to="/security-events">
              {t("settings.securityAudit")}
            </Link>
          </div>
        </article>

        <article className="card">
          <h2>{t("settings.onboardingReset")}</h2>
          <p className="text-muted">
            {onboardingCompleted ? t("onboarding.alreadyDone") : t("onboarding.subtitle")}
          </p>
          <div className="inline-actions">
            <button type="button" onClick={() => setOnboardingCompleted(false)}>
              {t("settings.markIncomplete")}
            </button>
            <button type="button" onClick={() => setOnboardingCompleted(true)}>
              {t("settings.markComplete")}
            </button>
          </div>
        </article>

        <article className="card">
          <h2>{t("home.sessionMessaging")}</h2>
          {session ? (
            <>
              <p>
                <strong>{t("home.account")}:</strong> {session.accountId}
              </p>
              <p>
                <strong>{t("home.email")}:</strong> {session.email || t("common.none")}
              </p>
            </>
          ) : (
            <p className="text-muted">{t("home.notAuthenticated")}</p>
          )}
        </article>
      </div>
    </section>
  );
}
