import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { appConfig } from "@/lib/config";
import { clearSession } from "@/services/authSession";
import { type AppLanguage, changeLanguage } from "@/services/i18n";
import { messagingRuntime } from "@/services/messaging/runtime";
import { clearServerConfig, getActiveServerConfig, getServerHostForDisplay } from "@/services/serverConnection";
import { updaterService } from "@/services/updater";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";
import { useSocialStore } from "@/state/socialStore";
import { useUpdaterStore } from "@/state/updaterStore";

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((state) => state.setOnboardingCompleted);
  const profile = useSocialStore((state) => state.profile);
  const updateProfile = useSocialStore((state) => state.updateProfile);
  const activeServer = getActiveServerConfig();

  const updaterSupported = useUpdaterStore((state) => state.supported);
  const updaterStatus = useUpdaterStore((state) => state.status);
  const updaterChannel = useUpdaterStore((state) => state.channel);
  const setUpdaterChannel = useUpdaterStore((state) => state.setChannel);
  const updaterVersion = useUpdaterStore((state) => state.availableVersion);
  const updaterNotes = useUpdaterStore((state) => state.releaseNotes);
  const updaterPublishedAt = useUpdaterStore((state) => state.publishedAt);
  const updaterProgress = useUpdaterStore((state) => state.progressPercent);
  const updaterLastCheckedAt = useUpdaterStore((state) => state.lastCheckedAt);
  const updaterError = useUpdaterStore((state) => state.errorMessage);

  const [updaterActionBusy, setUpdaterActionBusy] = useState<"check" | "download" | "restart" | null>(null);
  const [updaterHint, setUpdaterHint] = useState<string | null>(null);

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

  async function onCheckUpdates() {
    setUpdaterActionBusy("check");
    setUpdaterHint(null);
    try {
      const result = await updaterService.checkForUpdates({
        manual: true,
        showBanner: false,
      });

      if (!result.hasUpdate) {
        setUpdaterHint(t("updates.upToDate"));
      } else {
        setUpdaterHint(t("updates.availableVersion", { version: result.version }));
      }
    } catch {
      const currentError = useUpdaterStore.getState().errorMessage ?? "unknown";
      setUpdaterHint(t(`updates.errors.${currentError}`));
    } finally {
      setUpdaterActionBusy(null);
    }
  }

  async function onDownloadAndInstall() {
    setUpdaterActionBusy("download");
    setUpdaterHint(null);
    try {
      await updaterService.downloadAndInstallUpdate();
      setUpdaterHint(t("updates.downloaded"));
    } catch {
      const currentError = useUpdaterStore.getState().errorMessage ?? "unknown";
      setUpdaterHint(t(`updates.errors.${currentError}`));
    } finally {
      setUpdaterActionBusy(null);
    }
  }

  async function onRestartAndApply() {
    setUpdaterActionBusy("restart");
    try {
      await updaterService.relaunchToApplyUpdate();
    } finally {
      setUpdaterActionBusy(null);
    }
  }

  const updaterStatusLabel = useMemo(() => {
    return t(`updates.status.${updaterStatus}`);
  }, [t, updaterStatus]);

  return (
    <section className="page-stack">
      <h1>{t("settings.title")}</h1>
      <p className="text-muted">{t("settings.subtitle")}</p>

      <div className="card-grid">
        <article className="card" id="updates">
          <h2>{t("updates.title")}</h2>
          <p className="text-muted">{t("updates.subtitle")}</p>

          <p>
            <strong>{t("common.status")}:</strong> {updaterStatusLabel}
          </p>
          <p>
            <strong>{t("updates.channel")}:</strong>
          </p>
          <select value={updaterChannel} onChange={(event) => setUpdaterChannel(event.target.value === "beta" ? "beta" : "stable")}>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
          <p className="text-muted">{t("updates.channelHelp")}</p>

          {updaterVersion ? (
            <>
              <p>
                <strong>{t("updates.available")}:</strong> {updaterVersion}
              </p>
              {updaterPublishedAt ? (
                <p className="text-muted">
                  <strong>{t("updates.publishedAt")}:</strong> {updaterPublishedAt}
                </p>
              ) : null}
              {updaterNotes ? <pre className="release-notes">{updaterNotes}</pre> : null}
            </>
          ) : null}

          {updaterStatus === "downloading" ? (
            <div className="progress-wrap">
              <progress max={100} value={updaterProgress} />
              <span className="text-muted">{updaterProgress}%</span>
            </div>
          ) : null}

          <div className="inline-actions section-offset-sm">
            <button type="button" onClick={() => void onCheckUpdates()} disabled={updaterActionBusy !== null || !updaterSupported}>
              {updaterActionBusy === "check" ? t("updates.checking") : t("updates.checkNow")}
            </button>

            {updaterStatus === "available" ? (
              <button type="button" onClick={() => void onDownloadAndInstall()} disabled={updaterActionBusy !== null}>
                {updaterActionBusy === "download" ? t("updates.downloading") : t("updates.downloadAndInstall")}
              </button>
            ) : null}

            {updaterStatus === "downloaded" ? (
              <button type="button" onClick={() => void onRestartAndApply()} disabled={updaterActionBusy !== null}>
                {updaterActionBusy === "restart" ? t("updates.restarting") : t("updates.restartToApply")}
              </button>
            ) : null}
          </div>

          {updaterHint ? <p className="text-muted">{updaterHint}</p> : null}
          {updaterError ? <p className="error-text">{t(`updates.errors.${updaterError}`)}</p> : null}
          {updaterLastCheckedAt ? (
            <p className="text-muted">
              <strong>{t("updates.lastChecked")}:</strong> {updaterLastCheckedAt}
            </p>
          ) : null}
          {!updaterSupported ? <p className="text-muted">{t("updates.unsupported")}</p> : null}
        </article>

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
          <h2>{t("friends.myProfile")}</h2>
          <label>
            {t("friends.profileName")}
            <input value={profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} />
          </label>
          <label>
            {t("friends.profileBio")}
            <input value={profile.bio} onChange={(event) => updateProfile({ bio: event.target.value })} />
          </label>
          <label>
            {t("friends.profileAvatarColor")}
            <input type="color" value={profile.avatarColor} onChange={(event) => updateProfile({ avatarColor: event.target.value })} />
          </label>
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
          <div className="inline-actions section-offset-sm">
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
            <Link className="button-link" to="/friends">
              {t("nav.friends")}
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
