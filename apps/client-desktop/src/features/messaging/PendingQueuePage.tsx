import { useState } from "react";
import { useTranslation } from "react-i18next";

import { extractApiErrorMessage } from "@/services/apiClient";
import { messagingRuntime } from "@/services/messaging/runtime";
import { useMessagingStore } from "@/state/messagingStore";

export function PendingQueuePage() {
  const { t } = useTranslation();
  const outbox = useMessagingStore((state) => state.outbox);
  const transport = useMessagingStore((state) => state.transport);

  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function retryAll() {
    setWorking(true);
    setError(null);
    try {
      await messagingRuntime.retryOutbox();
    } catch (retryError) {
      setError(extractApiErrorMessage(retryError));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="page-stack">
      <h1>{t("messaging.pendingQueueTitle")}</h1>
      <p className="text-muted">{t("messaging.pendingQueueSubtitle")}</p>

      <article className="card">
        <p>
          <strong>{t("home.transport")}:</strong> {transport.mode} / {transport.status}
        </p>
        <p className="text-muted">
          {t("common.endpoint")}: {transport.endpoint ?? "-"}
        </p>
      </article>

      <div className="inline-actions">
        <button type="button" disabled={working || outbox.length === 0} onClick={() => void retryAll()}>
          {working ? t("messaging.retrying") : t("messaging.retryAll")}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {outbox.length === 0 ? (
        <p className="text-muted">{t("messaging.queueEmpty")}</p>
      ) : (
        outbox.map((item) => (
          <article className="list-item" key={item.clientMessageId}>
            <p>
              <strong>{item.clientMessageId}</strong>
            </p>
            <p className="text-muted">conversation {item.conversationId}</p>
            <p className="text-muted">
              {t("common.retries")} {item.retryCount} | {t("common.created")} {item.createdAt}
            </p>
          </article>
        ))
      )}
    </section>
  );
}
