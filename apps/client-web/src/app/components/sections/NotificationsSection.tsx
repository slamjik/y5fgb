import type { NotificationsResponse } from "@project/protocol";
import * as React from "react";

import { cardStyle } from "../../styles";
import { InlineInfo } from "../common/StatusInfo";

type NotificationsSectionProps = {
  notifications: NotificationsResponse["notifications"];
  renderTitle: (item: NotificationsResponse["notifications"][number]) => string;
};

export function NotificationsSection({ notifications, renderTitle }: NotificationsSectionProps) {
  if (notifications.length === 0) {
    return (
      <section className="space-y-3">
        <InlineInfo text="Пока нет уведомлений." />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {notifications.map((item) => (
        <div key={`${item.id}_${item.createdAt as string}`} className="rounded-xl border p-3" style={cardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>{renderTitle(item)}</p>
          {item.preview ? <p style={{ color: "var(--base-grey-light)", marginTop: 6 }}>{item.preview}</p> : null}
          <p style={{ color: "var(--base-grey-light)", marginTop: 6, fontSize: 12 }}>
            {new Date(item.createdAt as string).toLocaleString("ru-RU")}
          </p>
        </div>
      ))}
    </section>
  );
}

