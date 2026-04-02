import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";

export function RequireAuth() {
  const location = useLocation();
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);

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
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);

  if (!initialized) {
    return <p>{t("common.loadingSession")}</p>;
  }

  if (accessToken && session) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

