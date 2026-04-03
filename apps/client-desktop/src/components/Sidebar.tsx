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
  const connectionLabel = hasServerConnection ? t("home.ready") : t("home.disabled");
  const navItems = hasServerConnection
    ? session
      ? [
          { to: "/", label: t("nav.conversations"), icon: "💬" },
          { to: "/friends", label: t("nav.friends"), icon: "🤝" },
          { to: "/devices", label: t("nav.devices"), icon: "🛡️" },
          { to: "/plugins", label: t("nav.plugins"), icon: "🧩" },
          { to: "/settings", label: t("nav.settings"), icon: "⚙️" },
        ]
      : [
          { to: "/auth/login", label: t("nav.login"), icon: "🔐" },
          { to: "/auth/register", label: t("nav.register"), icon: "📝" },
        ]
    : [{ to: "/connect-server", label: t("serverConnect.title"), icon: "🌐" }];

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
      <div className="sidebar-brand-wrap">
        <div className="sidebar-brand-row">
          <div className="sidebar-brand">{t("common.appName")}</div>
          <span className={`status-chip ${hasServerConnection ? "status-delivered" : "status-failed"}`}>{connectionLabel}</span>
        </div>
        <p className="sidebar-brand-subtitle">{t("messaging.conversationsSubtitle")}</p>
      </div>

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
        {!onboardingCompleted && session ? (
          <NavLink className="sidebar-link" to="/onboarding">
            <span className="sidebar-link-content">
              <span className="sidebar-link-icon" aria-hidden="true">
                🚀
              </span>
              <span className="sidebar-link-label">{t("nav.onboarding")}</span>
            </span>
          </NavLink>
        ) : null}

        {navItems.map((item) => (
          <NavLink key={item.to} className="sidebar-link" to={item.to}>
            <span className="sidebar-link-content">
              <span className="sidebar-link-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="sidebar-link-label">{item.label}</span>
            </span>
          </NavLink>
        ))}

        {session ? (
          <button className="sidebar-link" type="button" onClick={logout}>
            <span className="sidebar-link-content">
              <span className="sidebar-link-icon" aria-hidden="true">
                ↩️
              </span>
              <span className="sidebar-link-label">{t("nav.logout")}</span>
            </span>
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
