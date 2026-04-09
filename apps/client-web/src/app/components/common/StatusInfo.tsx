import { AlertTriangle, Loader2, Wifi, WifiOff } from "lucide-react";

import type { RuntimeTransportState } from "../../../features/messaging/runtime";
import type { UploadFeedback } from "../../types";
import { innerCardStyle } from "../../styles";

export function InlineInfo({ text, tone = "default" }: { text: string; tone?: "default" | "error" | "warning" }) {
  const color = tone === "error" ? "#fca5a5" : tone === "warning" ? "#fde68a" : "var(--text-primary)";
  return (
    <div className="rounded-xl border px-3 py-2 interactive-surface-subtle" style={innerCardStyle}>
      <p style={{ color }}>{text}</p>
    </div>
  );
}

export function UploadStatusPill({ label, status }: { label: string; status: UploadFeedback }) {
  if (status.phase === "idle") {
    return null;
  }

  const accentColor =
    status.phase === "error"
      ? "#fca5a5"
      : status.phase === "success"
        ? "#86efac"
        : "var(--accent-brown)";

  return (
    <div className="rounded-lg border px-3 py-2 space-y-2 interactive-surface-subtle" style={innerCardStyle}>
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: "var(--base-grey-light)" }}>{label}</span>
        <span style={{ color: accentColor }}>
          {status.phase === "uploading" ? `${status.percent}%` : status.phase === "success" ? "РЈСЃРїРµС€РЅРѕ" : "РћС€РёР±РєР°"}
        </span>
      </div>
      <div className="h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.09)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${
              status.phase === "uploading"
                ? status.percent
                : status.phase === "success"
                  ? 100
                  : Math.max(12, status.percent)
            }%`,
            backgroundColor: accentColor,
            opacity: status.phase === "error" ? 0.65 : 1,
          }}
        />
      </div>
      <p style={{ color: accentColor, fontSize: 12 }}>{status.message}</p>
    </div>
  );
}

export function StatusChip({ state }: { state: RuntimeTransportState["status"] }) {
  const descriptor =
    state === "connected"
      ? { label: "Онлайн", icon: Wifi, color: "#86efac" }
      : state === "degraded"
        ? { label: "Резервный канал", icon: AlertTriangle, color: "#fde68a" }
        : state === "syncing" || state === "connecting" || state === "reconnecting"
          ? { label: "Синхронизация", icon: Loader2, color: "#93c5fd" }
          : state === "auth_expired"
            ? { label: "Требуется вход", icon: AlertTriangle, color: "#fca5a5" }
            : { label: "Офлайн", icon: WifiOff, color: "#fca5a5" };
  const Icon = descriptor.icon;
  return (
    <span
      data-testid="transport-status-chip"
      data-status={state}
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-sm"
      style={innerCardStyle}
    >
      <Icon
        className={`w-4 h-4 ${state === "syncing" || state === "connecting" || state === "reconnecting" ? "animate-spin" : ""}`}
        style={{ color: descriptor.color }}
      />
      <span style={{ color: descriptor.color }}>{descriptor.label}</span>
    </span>
  );
}

export function TransportCard({ state }: { state: RuntimeTransportState }) {
  return (
    <div className="rounded-xl border p-3 space-y-1 interactive-surface-subtle" style={innerCardStyle}>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Режим: {state.mode}</p>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Статус: {state.status}</p>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Курсор: {state.lastCursor}</p>
      {state.lastSuccessfulSyncAt ? (
        <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
          Последняя синхронизация: {new Date(state.lastSuccessfulSyncAt).toLocaleTimeString("ru-RU")}
        </p>
      ) : null}
      {state.reconnectAttempt > 0 ? (
        <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Попытка reconnect: {state.reconnectAttempt}</p>
      ) : null}
      {state.endpoint ? (
        <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>
          Endpoint: {state.endpoint}
        </p>
      ) : null}
      {state.lastError ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{state.lastError}</p> : null}
    </div>
  );
}
