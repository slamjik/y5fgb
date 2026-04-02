import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { hasStoredServerConfig } from "@/services/serverConnection";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";

export function RequireAuth() {
  const location = useLocation();
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);

  if (!hasStoredServerConfig()) {
    return <Navigate to="/connect-server" replace />;
  }

  if (!initialized) {
    return <p>{t("common.loadingSession")}</p>;
  }

  if (!accessToken || !session) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  }

  if (!onboardingCompleted && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

export function RequireAnonymous() {
  const location = useLocation();
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);

  if (!hasStoredServerConfig()) {
    return <Navigate to="/connect-server" replace state={{ from: location.pathname }} />;
  }

  if (!initialized) {
    return <p>{t("common.loadingSession")}</p>;
  }

  if (accessToken && session) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function RequireMissingServerConnection() {
  const location = useLocation();
  const hasServer = hasStoredServerConfig();

  if (!hasServer) {
    return <Outlet />;
  }

  if (location.state && typeof location.state === "object" && "from" in location.state) {
    const fromValue = (location.state as { from?: string }).from;
    if (fromValue && fromValue !== "/connect-server") {
      return <Navigate to={fromValue} replace />;
    }
  }

  return <Navigate to="/auth/login" replace />;
}
