import React from "react";
import type { NotificationsResponse } from "@project/protocol";
import type { RuntimeTransportState } from "../features/messaging/runtime";

import type { SidebarSection } from "./components/Sidebar";

export function sectionTitle(section: SidebarSection): string {
  if (section === "messages") return "Сообщения";
  if (section === "feed") return "Лента";
  if (section === "explore") return "Обзор";
  if (section === "notifications") return "Уведомления";
  if (section === "profile") return "Профиль";
  return "Настройки";
}

export function sectionSubtitle(section: SidebarSection, server: string, transportState: RuntimeTransportState): string {
  if (section === "messages") return `Сервер: ${server} · ${transportState.status}`;
  return `Сервер: ${server}`;
}

export function normalizeUserSearchInput(value: string): string {
  return value.trim().replace(/^@+/, "").trim();
}

export function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function renderVisibilityScope(value: string): string {
  if (value === "public" || value === "everyone") return "всем";
  if (value === "friends") return "друзьям";
  if (value === "only_me") return "только мне";
  return value;
}

export function renderFriendState(value: string): string {
  if (value === "friends") return "друзья";
  if (value === "incoming_request") return "входящая заявка";
  if (value === "outgoing_request") return "исходящая заявка";
  if (value === "blocked") return "заблокирован";
  return "нет связи";
}

export function renderDeliveryState(value: string): string {
  if (value === "queued" || value === "pending") return "В очереди";
  if (value === "sent") return "Отправлено";
  if (value === "delivered") return "Доставлено";
  if (value === "read") return "Прочитано";
  if (value === "failed") return "Ошибка";
  return value;
}

export function renderNotificationTitle(item: NotificationsResponse["notifications"][number]): string {
  const actor = item.actorName || item.actorUsername || "Пользователь";
  if (item.type === "friend_request") return `${actor} отправил(а) заявку в друзья`;
  if (item.type === "friend_accepted") return `${actor} принял(а) заявку в друзья`;
  if (item.type === "story_published") return `${actor} опубликовал(а) историю`;
  if (item.type === "social_like") return `${actor} поставил(а) лайк`;
  return "Новое уведомление";
}

export function resolveConversationTitle(summary: {
  title: string | null;
  type: string;
  directPeerEmail: string | null;
  directPeerAccountId: string | null;
} | null): string {
  if (!summary) return "Чат";
  if (summary.title && summary.title.trim()) return summary.title;
  if (summary.type === "direct") return summary.directPeerEmail || summary.directPeerAccountId || "Личный чат";
  return "Группа";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 Б";
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

export function linkifyText(text: string): React.ReactNode {
  const normalized = text || "";
  const regex = /(https?:\/\/[^\s]+)/gi;
  const parts = normalized.split(regex);
  if (parts.length === 1) {
    return normalized;
  }
  return parts.map((part, index) => {
    if (!/^https?:\/\/[^\s]+$/i.test(part)) {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }
    return (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: "var(--accent-brown)", textDecoration: "underline" }}
      >
        {part}
      </a>
    );
  });
}
