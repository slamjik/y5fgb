import { useTranslation } from "react-i18next";

import { useMessagingStore } from "@/state/messagingStore";

export function TransportHealthPage() {
  const { t } = useTranslation();
  const transport = useMessagingStore((state) => state.transport);
  const outboxCount = useMessagingStore((state) => state.outbox.length);

  return (
    <section className="page-stack">
      <h1>{t("messaging.transportHealthTitle")}</h1>
      <p className="text-muted">{t("messaging.transportHealthSubtitle")}</p>

      <article className="card">
        <p>
          <strong>{t("common.mode")}:</strong> {transport.mode}
        </p>
        <p>
          <strong>{t("common.status")}:</strong> {transport.status}
        </p>
        <p>
          <strong>{t("common.endpoint")}:</strong> {transport.endpoint ?? "-"}
        </p>
        <p>
          <strong>{t("common.syncCursor")}:</strong> {transport.lastCursor}
        </p>
        <p>
          <strong>{t("nav.outbox")}:</strong> {outboxCount}
        </p>
        <p>
          <strong>{t("common.updated")}:</strong> {transport.updatedAt ?? "-"}
        </p>
        {transport.lastError ? <p className="error-text">{transport.lastError}</p> : null}
      </article>
    </section>
  );
}
