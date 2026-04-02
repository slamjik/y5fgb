import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SecurityEventDTO } from "@project/protocol";

import { extractApiErrorMessage } from "@/services/apiClient";
import { securityEventsApi } from "@/services/securityEventsApi";
import { useAuthStore } from "@/state/authStore";

export function SecurityEventsPage() {
  const { t } = useTranslation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [events, setEvents] = useState<SecurityEventDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void load();
  }, [accessToken]);

  async function load() {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await securityEventsApi.list(accessToken);
      setEvents(response.events);
    } catch (loadError) {
      setError(extractApiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1>{t("securityEvents.title")}</h1>
      <p className="text-muted">{t("securityEvents.subtitle")}</p>
      <button type="button" onClick={load} disabled={loading}>
        {loading ? t("common.loading") : t("common.refresh")}
      </button>

      {events.length === 0 ? <p>{t("securityEvents.noEvents")}</p> : null}
      <div className="card-grid">
        {events.map((event) => (
          <article className="card" key={event.id}>
            <h2>{event.eventType}</h2>
            <p>
              {t("securityEvents.severity")}: {event.severity}
            </p>
            <p>
              {t("securityEvents.trustState")}: {event.trustState}
            </p>
            <p>
              {t("securityEvents.device")}: {event.deviceId ?? "-"}
            </p>
            <p>
              {t("securityEvents.at")}: {event.createdAt}
            </p>
          </article>
        ))}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

