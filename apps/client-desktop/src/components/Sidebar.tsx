import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router-dom";

import { authApi } from "@/services/authApi";
import { clearSession } from "@/services/authSession";
import { REFRESH_TOKEN_KEY } from "@/services/authTokens";
import { hasStoredServerConfig } from "@/services/serverConnection";
import { secureStorage } from "@/services/secureStorage";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";
import { useSocialStore } from "@/state/socialStore";

export function Sidebar() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const hasServerConnection = hasStoredServerConfig();
  const conversations = useMessagingStore((state) => state.conversations);
  const profile = useSocialStore((state) => state.profile);

  const groupQuickLinks = useMemo(
    () => conversations.filter((conversation) => conversation.type === "group").slice(0, 6),
    [conversations],
  );

  const profileLabel = profile.displayName.trim() || session?.email || t("friends.profileFallback");

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

      <section className="sidebar-profile-card">
        <div className="avatar-badge" style={{ backgroundColor: profile.avatarColor }} aria-hidden="true">
          {profileLabel.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="sidebar-profile-name">{profileLabel}</p>
          <p className="sidebar-profile-subtitle">{session?.accountId?.slice(0, 14) || t("home.notAuthenticated")}</p>
        </div>
      </section>

      <div className="sidebar-create-wrap">
        <NavLink className="sidebar-link sidebar-primary-link" to="/">
          {t("messaging.newChat")}
        </NavLink>
      </div>

      <nav className="sidebar-nav">
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
            <NavLink className="sidebar-link" to="/">
              {t("nav.conversations")}
            </NavLink>
            <NavLink className="sidebar-link" to="/friends">
              {t("nav.friends")}
            </NavLink>
            <NavLink className="sidebar-link" to="/devices">
              {t("nav.devices")}
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

      {session && groupQuickLinks.length > 0 ? (
        <section className="sidebar-groups">
          <p className="sidebar-section-title">{t("messaging.messageTypeGroup")}</p>
          <div className="sidebar-group-grid">
            {groupQuickLinks.map((group) => (
              <button key={group.id} type="button" className="sidebar-group-pill" onClick={() => navigate(`/conversations/${group.id}`)}>
                {(group.title || "#").slice(0, 2).toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sidebar-footer">{t("nav.footer")}</div>
    </aside>
  );
}
