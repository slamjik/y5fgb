import React from "react";
import type { NotificationsResponse } from "@project/protocol";
import type { RuntimeTransportState } from "../features/messaging/runtime";

import type { SidebarSection } from "./components/Sidebar";

export function sectionTitle(section: SidebarSection): string {
  if (section === "messages") return "РЎРѕРѕР±С‰РµРЅРёСЏ";
  if (section === "feed") return "Р›РµРЅС‚Р°";
  if (section === "explore") return "РћР±Р·РѕСЂ";
  if (section === "notifications") return "РЈРІРµРґРѕРјР»РµРЅРёСЏ";
  if (section === "profile") return "РџСЂРѕС„РёР»СЊ";
  return "РќР°СЃС‚СЂРѕР№РєРё";
}

export function sectionSubtitle(section: SidebarSection, server: string, transportState: RuntimeTransportState): string {
  if (section === "messages") return `Server: ${server} | ${renderTransportStatusLabel(transportState.status)}`;
  return `Server: ${server}`;
}

function renderTransportStatusLabel(status: RuntimeTransportState["status"]): string {
  if (status === "connected") return "online";
  if (status === "degraded") return "fallback";
  if (status === "syncing") return "syncing";
  if (status === "connecting") return "connecting";
  if (status === "reconnecting") return "reconnecting";
  if (status === "auth_expired") return "reauth required";
  return "offline";
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
  if (value === "public" || value === "everyone") return "РІСЃРµРј";
  if (value === "friends") return "РґСЂСѓР·СЊСЏРј";
  if (value === "only_me") return "С‚РѕР»СЊРєРѕ РјРЅРµ";
  return value;
}

export function renderFriendState(value: string): string {
  if (value === "friends") return "РґСЂСѓР·СЊСЏ";
  if (value === "incoming_request") return "РІС…РѕРґСЏС‰Р°СЏ Р·Р°СЏРІРєР°";
  if (value === "outgoing_request") return "РёСЃС…РѕРґСЏС‰Р°СЏ Р·Р°СЏРІРєР°";
  if (value === "blocked") return "Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅ";
  return "РЅРµС‚ СЃРІСЏР·Рё";
}

export function renderDeliveryState(value: string): string {
  if (value === "queued" || value === "pending") return "Р’ РѕС‡РµСЂРµРґРё";
  if (value === "sent") return "РћС‚РїСЂР°РІР»РµРЅРѕ";
  if (value === "delivered") return "Р”РѕСЃС‚Р°РІР»РµРЅРѕ";
  if (value === "read") return "РџСЂРѕС‡РёС‚Р°РЅРѕ";
  if (value === "failed") return "РћС€РёР±РєР°";
  return value;
}

export function renderNotificationTitle(item: NotificationsResponse["notifications"][number]): string {
  const actor = item.actorName || item.actorUsername || "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ";
  if (item.type === "friend_request") return `${actor} РѕС‚РїСЂР°РІРёР»(Р°) Р·Р°СЏРІРєСѓ РІ РґСЂСѓР·СЊСЏ`;
  if (item.type === "friend_accepted") return `${actor} РїСЂРёРЅСЏР»(Р°) Р·Р°СЏРІРєСѓ РІ РґСЂСѓР·СЊСЏ`;
  if (item.type === "story_published") return `${actor} РѕРїСѓР±Р»РёРєРѕРІР°Р»(Р°) РёСЃС‚РѕСЂРёСЋ`;
  if (item.type === "social_like") return `${actor} РїРѕСЃС‚Р°РІРёР»(Р°) Р»Р°Р№Рє`;
  return "РќРѕРІРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ";
}

export function resolveConversationTitle(summary: {
  title: string | null;
  type: string;
  directPeerEmail: string | null;
  directPeerAccountId: string | null;
} | null): string {
  if (!summary) return "Р§Р°С‚";
  if (summary.title && summary.title.trim()) return summary.title;
  if (summary.type === "direct") return summary.directPeerEmail || summary.directPeerAccountId || "Р›РёС‡РЅС‹Р№ С‡Р°С‚";
  return "Р“СЂСѓРїРїР°";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 Р‘";
  if (value < 1024) return `${value} Р‘`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} РљР‘`;
  return `${(value / (1024 * 1024)).toFixed(1)} РњР‘`;
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

