import { createInitialTransportLifecycle, transitionTransportLifecycle, type ServerBootstrapConfig, type TransportLifecycleSnapshot } from "@project/client-core";
import type { TransportLifecycleEvent } from "@project/shared-types";

import { HttpRequestError, requestJSON } from "../lib/http";

export interface RuntimeTransportSnapshot {
  mode: "none" | "websocket" | "long-poll";
  status: "offline" | "connecting" | "online" | "degraded" | "forbidden";
  endpoint: string | null;
  cursor: number;
  queueSize: number;
  updatedAt: string;
}

export interface TransportControllerOptions {
  config: ServerBootstrapConfig;
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<boolean>;
  onLifecycle: (snapshot: TransportLifecycleSnapshot) => void;
  onRuntimeSnapshot: (snapshot: RuntimeTransportSnapshot) => void;
  onForbidden: () => void;
  onError: (message: string) => void;
}

export interface TransportController {
  start(): void;
  reconnect(): void;
  stop(): void;
}

const pollLimit = 100;

export function createTransportController(options: TransportControllerOptions): TransportController {
  let stopped = false;
  let ws: WebSocket | null = null;
  let pollTimer: number | null = null;
  let cursor = 0;
  let runtimeSnapshot: RuntimeTransportSnapshot = {
    mode: "none",
    status: "offline",
    endpoint: null,
    cursor,
    queueSize: 0,
    updatedAt: new Date().toISOString(),
  };
  let lifecycle = createInitialTransportLifecycle();
  let reconnectAttempts = 0;

  const handleOnline = () => {
    emitLifecycle("online_changed");
    void openWebSocket();
  };
  const handleOffline = () => {
    emitLifecycle("online_changed");
    closeWebSocket();
    updateRuntime({ status: "offline", mode: "none", endpoint: null });
  };
  const handleVisibility = () => {
    emitLifecycle("visibility_changed");
    if (document.visibilityState === "visible") {
      void openWebSocket();
    }
  };

  return {
    start() {
      stopped = false;
      emitLifecycle("config_loaded");
      emitLifecycle("auth_restored");
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      document.addEventListener("visibilitychange", handleVisibility);
      void openWebSocket();
    },
    reconnect() {
      if (stopped) {
        return;
      }
      reconnectAttempts = 0;
      void openWebSocket(true);
    },
    stop() {
      stopped = true;
      stopPolling();
      closeWebSocket();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      updateRuntime({ mode: "none", status: "offline", endpoint: null });
    },
  };

  async function openWebSocket(forceReconnect = false): Promise<void> {
    if (stopped || typeof window === "undefined") {
      return;
    }

    if (!window.navigator.onLine) {
      updateRuntime({ mode: "none", status: "offline", endpoint: null });
      return;
    }

    if (!forceReconnect && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const accessToken = await resolveAccessToken();
    if (!accessToken) {
      updateRuntime({ mode: "none", status: "forbidden", endpoint: null });
      options.onForbidden();
      return;
    }

    stopPolling();
    closeWebSocket();

    emitLifecycle("token_refreshed");
    updateRuntime({ mode: "websocket", status: "connecting", endpoint: options.config.wsUrl });

    try {
      const offeredProtocols = ["sm.v1", `sm.auth.${accessToken}`];
      ws = new WebSocket(options.config.wsUrl, offeredProtocols);
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "websocket initialization failed");
      enterFallback("websocket init failed");
      return;
    }

    ws.onopen = () => {
      reconnectAttempts = 0;
      emitLifecycle("ws_connected");
      updateRuntime({ mode: "websocket", status: "online", endpoint: options.config.wsUrl });
    };

    ws.onmessage = (event) => {
      const payload = safeJsonParse(event.data);
      const eventType = parseServerEventType(payload);
      if (eventType === "server.sync_available") {
        void pollOnce();
      }
    };

    ws.onclose = () => {
      if (stopped) {
        return;
      }
      emitLifecycle("ws_disconnected");
      enterFallback("websocket closed");
    };

    ws.onerror = () => {
      if (stopped) {
        return;
      }
      enterFallback("websocket error");
    };
  }

  function closeWebSocket() {
    if (!ws) {
      return;
    }
    const instance = ws;
    ws = null;
    if (instance.readyState === WebSocket.OPEN || instance.readyState === WebSocket.CONNECTING) {
      instance.close();
    }
  }

  function enterFallback(reason: string) {
    if (stopped) {
      return;
    }
    emitLifecycle("poll_fallback_entered");
    updateRuntime({ mode: "long-poll", status: "degraded", endpoint: buildPollEndpoint() });
    options.onError(reason);
    startPolling();
  }

  function startPolling() {
    if (pollTimer || stopped) {
      return;
    }

    const timeoutSec = options.config.transportHints?.longPollTimeoutSec ?? 25;
    const run = async () => {
      if (stopped) {
        return;
      }
      await pollOnce();
      if (stopped) {
        return;
      }

      reconnectAttempts += 1;
      if (reconnectAttempts >= 3 && window.navigator.onLine) {
        reconnectAttempts = 0;
        void openWebSocket(true);
      }

      const minBackoffMs = options.config.transportHints?.reconnectBackoffMinMs ?? 500;
      const maxBackoffMs = options.config.transportHints?.reconnectBackoffMaxMs ?? 10000;
      const reconnectBackoffMs = Math.min(maxBackoffMs, minBackoffMs * 2 ** Math.max(0, reconnectAttempts - 1));
      const jitterMs = Math.floor(reconnectBackoffMs * (Math.random() * 0.3));
      pollTimer = window.setTimeout(run, Math.max(timeoutSec, 2) * 1000 + jitterMs);
    };

    pollTimer = window.setTimeout(run, 0);
  }

  function stopPolling() {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function pollOnce(): Promise<void> {
    if (stopped) {
      return;
    }

    const accessToken = await resolveAccessToken();
    if (!accessToken) {
      updateRuntime({ mode: "none", status: "forbidden", endpoint: null });
      options.onForbidden();
      return;
    }

    try {
      const timeoutSec = options.config.transportHints?.longPollTimeoutSec ?? 25;
      const url = `${buildPollEndpoint()}?cursor=${cursor}&limit=${pollLimit}&timeoutSec=${timeoutSec}`;
      const response = await requestJSON<{ batch?: { toCursor?: number } }>({
        method: "GET",
        url,
        accessToken,
        timeoutMs: Math.max(timeoutSec + 5, 10) * 1000,
      });

      const nextCursor = response.batch?.toCursor;
      if (typeof nextCursor === "number" && Number.isFinite(nextCursor) && nextCursor > cursor) {
        cursor = nextCursor;
      }
      emitLifecycle("resync_completed");
      updateRuntime({ mode: runtimeSnapshot.mode, status: "degraded", cursor, endpoint: runtimeSnapshot.endpoint });
    } catch (error) {
      if (error instanceof HttpRequestError && (error.status === 401 || error.status === 403)) {
        updateRuntime({ mode: "none", status: "forbidden", endpoint: null });
        options.onForbidden();
        return;
      }
      updateRuntime({ mode: "long-poll", status: window.navigator.onLine ? "degraded" : "offline", endpoint: buildPollEndpoint() });
    }
  }

  async function resolveAccessToken(): Promise<string | null> {
    const current = await options.getAccessToken();
    if (current) {
      return current;
    }

    const refreshed = await options.refreshAccessToken();
    if (!refreshed) {
      return null;
    }
    return options.getAccessToken();
  }

  function emitLifecycle(event: TransportLifecycleEvent) {
    lifecycle = transitionTransportLifecycle(lifecycle, event);
    options.onLifecycle(lifecycle);
  }

  function updateRuntime(patch: Partial<RuntimeTransportSnapshot>) {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      ...patch,
      cursor,
      updatedAt: new Date().toISOString(),
    };
    options.onRuntimeSnapshot(runtimeSnapshot);
  }

  function buildPollEndpoint(): string {
    const cleanedPrefix = options.config.apiPrefix.endsWith("/")
      ? options.config.apiPrefix.slice(0, -1)
      : options.config.apiPrefix;
    return new URL(`${cleanedPrefix}/sync/poll`, `${options.config.apiBaseUrl}/`).toString();
  }
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseServerEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const envelope = (payload as Record<string, unknown>).envelope;
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const eventType = (envelope as Record<string, unknown>).type;
  return typeof eventType === "string" ? eventType : null;
}
