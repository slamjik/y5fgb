import type { NotificationType, NotificationsResponse } from "@project/protocol";
import * as React from "react";

import { cardStyle, innerCardStyle, outlineButtonStyle, solidButtonStyle } from "../../styles";
import { InlineInfo } from "../common/StatusInfo";

type NotificationsSectionProps = {
  notifications: NotificationsResponse["notifications"];
  unreadTotal: number;
  loading: boolean;
  error: string;
  renderTitle: (item: NotificationsResponse["notifications"][number]) => string;
  onRefresh: () => void;
  onOpen: (item: NotificationsResponse["notifications"][number]) => void;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onClearAll: () => Promise<void>;
};

type StatusFilter = "all" | "unread" | "read";

const typeOptions: Array<{ value: "all" | NotificationType; label: string }> = [
  { value: "all", label: "Все" },
  { value: "social_like", label: "Лайки" },
  { value: "friend_request", label: "Заявки" },
  { value: "friend_accepted", label: "Принятия" },
  { value: "story_published", label: "Истории" },
];

export function NotificationsSection({
  notifications,
  unreadTotal,
  loading,
  error,
  renderTitle,
  onRefresh,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationsSectionProps) {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = React.useState<"all" | NotificationType>("all");
  const [busyAction, setBusyAction] = React.useState<"markAll" | "clearAll" | null>(null);
  const [busyByID, setBusyByID] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    return notifications.filter((item) => {
      if (statusFilter === "unread" && item.isRead) return false;
      if (statusFilter === "read" && !item.isRead) return false;
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, statusFilter, typeFilter]);

  const markOneRead = async (id: string) => {
    setBusyByID((prev) => ({ ...prev, [id]: true }));
    try {
      await onMarkRead(id);
    } finally {
      setBusyByID((prev) => ({ ...prev, [id]: false }));
    }
  };

  const markAllRead = async () => {
    setBusyAction("markAll");
    try {
      await onMarkAllRead();
    } finally {
      setBusyAction(null);
    }
  };

  const clearAll = async () => {
    setBusyAction("clearAll");
    try {
      await onClearAll();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border p-3 space-y-3" style={cardStyle}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            Непрочитанные: {unreadTotal}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              data-testid="notifications-refresh"
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={outlineButtonStyle}
              onClick={onRefresh}
            >
              Обновить
            </button>
            <button
              type="button"
              data-testid="notifications-mark-all-read"
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-60"
              style={outlineButtonStyle}
              onClick={() => void markAllRead()}
              disabled={busyAction !== null || unreadTotal <= 0}
            >
              {busyAction === "markAll" ? "Отмечаем..." : "Отметить все"}
            </button>
            <button
              type="button"
              data-testid="notifications-clear-all"
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-60"
              style={outlineButtonStyle}
              onClick={() => void clearAll()}
              disabled={busyAction !== null || notifications.length === 0}
            >
              {busyAction === "clearAll" ? "Очищаем..." : "Очистить все"}
            </button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(["all", "unread", "read"] as StatusFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className="px-2 py-1 rounded-lg border text-xs"
              style={statusFilter === value ? solidButtonStyle : outlineButtonStyle}
              onClick={() => setStatusFilter(value)}
            >
              {value === "all" ? "Все" : value === "unread" ? "Непрочитанные" : "Прочитанные"}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          {typeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              data-testid={`notifications-type-filter-${option.value}`}
              className="px-2 py-1 rounded-lg border text-xs"
              style={typeFilter === option.value ? solidButtonStyle : outlineButtonStyle}
              onClick={() => setTypeFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <InlineInfo text="Загружаем уведомления..." /> : null}
      {error ? <InlineInfo tone="error" text={error} /> : null}

      {!loading && !error && filtered.length === 0 ? (
        <InlineInfo text={notifications.length === 0 ? "Пока нет уведомлений." : "По фильтрам ничего не найдено."} />
      ) : null}

      {filtered.map((item) => {
        const id = item.id as string;
        const isBusy = Boolean(busyByID[id]);
        return (
          <div
            key={`${item.id}_${item.createdAt as string}`}
            data-testid={`notification-item-${id}`}
            className="rounded-xl border p-3 space-y-2"
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                data-testid={`notification-open-${id}`}
                className="text-left"
                style={{ color: "var(--text-primary)", fontWeight: 600 }}
                onClick={() => onOpen(item)}
              >
                {renderTitle(item)}
              </button>
              {!item.isRead ? (
                <span
                  className="w-2.5 h-2.5 rounded-full mt-1"
                  style={{ backgroundColor: "var(--accent-brown)", flexShrink: 0 }}
                  aria-label="Непрочитано"
                />
              ) : null}
            </div>

            {item.preview ? <p style={{ color: "var(--base-grey-light)" }}>{item.preview}</p> : null}

            <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
              {new Date(item.createdAt as string).toLocaleString("ru-RU")}
              {item.isRead && item.readAt ? ` · Прочитано ${new Date(item.readAt as string).toLocaleString("ru-RU")}` : ""}
            </p>

            <div className="flex gap-2 flex-wrap">
              <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => onOpen(item)}>
                Открыть
              </button>
              {!item.isRead ? (
                <button
                  type="button"
                  data-testid={`notification-read-${id}`}
                  className="px-2 py-1 rounded-lg border text-xs disabled:opacity-60"
                  style={outlineButtonStyle}
                  onClick={() => void markOneRead(id)}
                  disabled={isBusy}
                >
                  {isBusy ? "..." : "Прочитано"}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border p-3" style={innerCardStyle}>
        <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
          Клик по уведомлению откроет связанный раздел: профиль, пост, заявки или чат.
        </p>
      </div>
    </section>
  );
}
