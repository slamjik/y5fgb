import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";

import { initApp } from "@/app/init";
import { router } from "@/app/router";
import i18n from "@/services/i18n";
import { logger } from "@/services/logger";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useAppStore } from "@/state/appStore";
import { useAuthStore } from "@/state/authStore";
import { useMessagingStore } from "@/state/messagingStore";

export function App() {
  const language = useAppStore((state) => state.language);
  const accessToken = useAuthStore((state) => state.accessToken);
  const sessionId = useAuthStore((state) => state.session?.session.id);

  useEffect(() => {
    void initApp();
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapMessagingRuntime() {
      if (!accessToken || !sessionId) {
        messagingRuntime.stop();
        useMessagingStore.getState().reset();
        return;
      }

      try {
        await messagingRuntime.start(accessToken);
      } catch (error) {
        if (cancelled) {
          return;
        }
        logger.warn("failed to start messaging runtime", { error });
        useMessagingStore.getState().setTransportState({
          mode: "none",
          status: "offline",
          lastError: "local_storage_unavailable",
        });
      }
    }

    void bootstrapMessagingRuntime();
    return () => {
      cancelled = true;
    };
  }, [accessToken, sessionId]);

  return <RouterProvider router={router} />;
}
