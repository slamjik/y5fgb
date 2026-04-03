import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";

import { authApi } from "@/services/authApi";
import { clearSession } from "@/services/authSession";
import { REFRESH_TOKEN_KEY } from "@/services/authTokens";
import { hasStoredServerConfig } from "@/services/serverConnection";
import { secureStorage } from "@/services/secureStorage";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";

export function Sidebar() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const hasServerConnection = hasStoredServerConfig();

  async function logout() {
    const refreshToken = await secureStorage.get(REFRESH_TOKEN_KEY);

    try {
      await authApi.logout(accessToken, refreshToken ?? undefined);
    } catch {
      // Ignore network or token errors and clear local state anyway.
    }

    await clearSession();
    navigate("/auth/login", { replace: true });
  }

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">{t("common.appName")}</div>

      <nav className="sidebar-nav">
        <NavLink className="sidebar-link" to="/">
          {t("nav.conversations")}
        </NavLink>

        {!hasServerConnection ? (
          <NavLink className="sidebar-link" to="/connect-server">
            {t("serverConnect.title")}
          </NavLink>
        ) : session ? (
          <>
            {!onboardingCompleted ? (
              <NavLink className="sidebar-link" to="/onboarding">
                {t("nav.onboarding")}
              </NavLink>
            ) : null}
            <NavLink className="sidebar-link" to="/messaging/outbox">
              {t("nav.outbox")}
            </NavLink>
            <NavLink className="sidebar-link" to="/messaging/transport">
              {t("nav.transport")}
            </NavLink>
            <NavLink className="sidebar-link" to="/home">
              {t("nav.home")}
            </NavLink>
            <NavLink className="sidebar-link" to="/devices">
              {t("nav.devices")}
            </NavLink>
            <NavLink className="sidebar-link" to="/friends">
              {t("nav.friends")}
            </NavLink>
            <NavLink className="sidebar-link" to="/security-events">
              {t("nav.securityEvents")}
            </NavLink>
            <NavLink className="sidebar-link" to="/plugins">
              {t("nav.plugins")}
            </NavLink>
            <NavLink className="sidebar-link" to="/settings">
              {t("nav.settings")}
            </NavLink>
          </>
        ) : (
          <>
            <NavLink className="sidebar-link" to="/auth/login">
              {t("nav.login")}
            </NavLink>
            <NavLink className="sidebar-link" to="/auth/register">
              {t("nav.register")}
            </NavLink>
          </>
        )}

        {session ? (
          <button className="sidebar-link" type="button" onClick={logout}>
            {t("nav.logout")}
          </button>
        ) : null}
      </nav>

      <div className="sidebar-footer">{t("nav.footer")}</div>
    </aside>
  );
}
