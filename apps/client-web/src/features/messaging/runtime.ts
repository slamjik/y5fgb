import type { SyncBatchDTO } from "@project/protocol";

import { ApiClientError, type WebApiClient } from "../../shared/api/client";

export type RuntimeTransportMode = "none" | "websocket" | "long_poll";
export type RuntimeTransportStatus =
  | "connecting"
  | "syncing"
  | "connected"
  | "degraded"
  | "reconnecting"
  | "offline"
  | "auth_expired";

export interface RuntimeTransportState {
  mode: RuntimeTransportMode;
  status: RuntimeTransportStatus;
  endpoint: string | null;
  lastError: string | null;
  lastCursor: number;
  lastSuccessfulSyncAt: string | null;
  reconnectAttempt: number;
  updatedAt: string;
}

type RuntimeCallbacks = {
  onBatch: (batch: SyncBatchDTO) => Promise<void> | void;
  onTransport: (state: RuntimeTransportState) => void;
  onError: (message: string) => void;
  onAuthExpired?: (message: string) => void;
  onTyping?: (event: { conversationId: string; accountId: string; isTyping: boolean; at: string }) => void;
};

const defaultTransportState: RuntimeTransportState = {
  mode: "none",
  status: "connecting",
  endpoint: null,
  lastError: null,
  lastCursor: 0,
  lastSuccessfulSyncAt: null,
  reconnectAttempt: 0,
  updatedAt: new Date().toISOString(),
};

const reconnectJitterFactor = 0.2;
const recentSyncGraceMs = 25_000;

export class WebMessagingRuntime {
  private callbacks: RuntimeCallbacks;
  private api: WebApiClient;
  private accessToken: string;

  private running = false;
  private ws: WebSocket | null = null;
  private wsEndpoints: string[] = [];
  private pollEndpoints: string[] = [];
  private wsIndex = 0;
  private pollIndex = 0;
  private longPollTimeoutSec = 25;
  private longPollEnabled = true;

  private reconnectBackoffMinMs = 500;
  private reconnectBackoffMaxMs = 10_000;
  private reconnectDelayMs = 500;
  private reconnectAttempt = 0;
  private suppressNextWsCloseError = false;

  private pollLoopPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private syncRunning = false;
  private queuedSyncHint: number | null = null;
  private lastCursor = 0;
  private lastSuccessfulSyncAtMs = 0;
  private consecutivePollFailures = 0;

  private transportState: RuntimeTransportState = { ...defaultTransportState };
  private onlineHandlerBound: (() => void) | null = null;
  private visibilityHandlerBound: (() => void) | null = null;
  private lastErrorFingerprint = "";
  private lastErrorAt = 0;

  constructor(api: WebApiClient, accessToken: string, callbacks: RuntimeCallbacks) {
    this.api = api;
    this.accessToken = accessToken;
    this.callbacks = callbacks;
  }

  async start(initialCursor = 0): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastCursor = Math.max(0, Math.floor(initialCursor));
    this.reconnectAttempt = 0;
    this.reconnectDelayMs = this.reconnectBackoffMinMs;
    this.lastSuccessfulSyncAtMs = 0;
    this.consecutivePollFailures = 0;
    this.queuedSyncHint = null;
    this.bindRuntimeListeners();
    this.setTransport({
      mode: "none",
      status: "connecting",
      endpoint: null,
      lastError: null,
      lastCursor: this.lastCursor,
      reconnectAttempt: 0,
      lastSuccessfulSyncAt: null,
    });

    const canContinue = await this.configureTransportSafe();
    if (!canContinue || !this.running) {
      return;
    }

    await this.bootstrapWithRecovery();
    if (!this.running) {
      return;
    }

    this.connectWebSocket();
    this.ensurePollLoop();
    if (this.longPollEnabled) {
      void this.triggerSync(this.lastCursor).catch((error) => {
        this.handleBackgroundSyncError(error);
      });
    }
  }

  stop() {
    this.running = false;
    this.queuedSyncHint = null;
    this.syncRunning = false;
    this.teardownRuntimeListeners();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setTransport({
      mode: "none",
      status: "offline",
      endpoint: null,
      lastError: null,
      lastCursor: this.lastCursor,
      reconnectAttempt: 0,
    });
  }

  async triggerSync(cursorHint?: number): Promise<void> {
    if (!this.running) {
      return;
    }
    if (typeof cursorHint === "number" && Number.isFinite(cursorHint)) {
      const safeHint = Math.max(0, Math.floor(cursorHint));
      this.queuedSyncHint = this.queuedSyncHint === null ? safeHint : Math.max(this.queuedSyncHint, safeHint);
    }
    if (this.syncRunning) {
      return;
    }

    this.syncRunning = true;
    try {
      do {
        const hint = this.queuedSyncHint;
        this.queuedSyncHint = null;
        await this.syncPoll(hint ?? undefined);
      } while (this.queuedSyncHint !== null && this.running);
    } finally {
      this.syncRunning = false;
    }
  }

  requestReconnect() {
    if (!this.running || this.transportState.status === "auth_expired") {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelayMs = this.reconnectBackoffMinMs;
    this.reconnectAttempt = 0;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      this.suppressNextWsCloseError = true;
      this.ws.close();
      return;
    }
    this.connectWebSocket();
    this.ensurePollLoop();
    if (this.longPollEnabled) {
      void this.triggerSync().catch((error) => this.handleBackgroundSyncError(error));
    }
  }

  private async configureTransportSafe(): Promise<boolean> {
    try {
      await this.configureTransport();
      return true;
    } catch (error) {
      if (this.handleAuthFailure(error)) {
        return false;
      }
      // Keep working with conservative defaults so runtime can recover without full page refresh.
      this.wsEndpoints = [];
      this.pollEndpoints = [];
      this.longPollEnabled = true;
      this.reconnectBackoffMinMs = Math.max(300, this.reconnectBackoffMinMs);
      this.reconnectBackoffMaxMs = Math.max(this.reconnectBackoffMinMs, this.reconnectBackoffMaxMs);
      this.reconnectDelayMs = this.reconnectBackoffMinMs;
      this.emitUserError(
        "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0442\u0440\u0430\u043d\u0441\u043f\u043e\u0440\u0442\u0430. \u041f\u0435\u0440\u0435\u0445\u043e\u0434\u0438\u043c \u043d\u0430 \u0440\u0435\u0437\u0435\u0440\u0432\u043d\u043e\u0435 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435.",
        "transport_config_load",
      );
      this.setTransport({
        mode: "long_poll",
        status: "degraded",
        endpoint: this.resolvePollEndpoint(),
        lastError: null,
        lastCursor: this.lastCursor,
      });
      return true;
    }
  }

  private async bootstrapWithRecovery(): Promise<void> {
    this.setTransport({
      mode: this.wsEndpoints.length > 0 ? "websocket" : "long_poll",
      status: "syncing",
      endpoint: this.wsEndpoints.length > 0 ? this.resolveWsEndpoint() : this.resolvePollEndpoint(),
      lastError: null,
      lastCursor: this.lastCursor,
    });
    try {
      await this.bootstrap();
      if (!this.running) {
        return;
      }
      this.lastSuccessfulSyncAtMs = Date.now();
      this.consecutivePollFailures = 0;
      this.setTransport({
        mode: this.wsEndpoints.length > 0 ? "websocket" : "long_poll",
        status: this.wsEndpoints.length > 0 ? "connecting" : "connected",
        endpoint: this.wsEndpoints.length > 0 ? this.resolveWsEndpoint() : this.resolvePollEndpoint(),
        lastError: null,
        lastCursor: this.lastCursor,
        lastSuccessfulSyncAt: new Date(this.lastSuccessfulSyncAtMs).toISOString(),
      });
    } catch (error) {
      if (this.handleAuthFailure(error)) {
        return;
      }
      this.setTransport({
        mode: this.longPollEnabled ? "long_poll" : "websocket",
        status: this.longPollEnabled ? "degraded" : "reconnecting",
        endpoint: this.longPollEnabled ? this.resolvePollEndpoint() : this.resolveWsEndpoint(),
        lastError: null,
        lastCursor: this.lastCursor,
      });
      this.emitUserError(
        "\u041f\u0435\u0440\u0432\u0438\u0447\u043d\u0430\u044f \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f \u0437\u0430\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f. \u0412\u043e\u0441\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u043c \u0434\u0430\u043d\u043d\u044b\u0435 \u0432 \u0444\u043e\u043d\u0435.",
        "bootstrap_delayed",
      );
    }
  }

  private async configureTransport() {
    const config = await this.api.transportEndpoints(this.accessToken);

    this.wsEndpoints = config.endpoints
      .filter((endpoint) => endpoint.enabled && endpoint.mode === "websocket")
      .map((endpoint) => endpoint.url);

    this.pollEndpoints = config.endpoints
      .filter((endpoint) => endpoint.enabled && endpoint.mode === "long_poll")
      .map((endpoint) => endpoint.url);

    this.longPollTimeoutSec = config.profile.longPollTimeoutSeconds;
    this.longPollEnabled = config.profile.longPollEnabled;
    this.reconnectBackoffMinMs = config.profile.reconnectBackoffMinMs;
    this.reconnectBackoffMaxMs = config.profile.reconnectBackoffMaxMs;
    this.reconnectDelayMs = this.reconnectBackoffMinMs;
  }

  private async bootstrap() {
    const response = await this.api.syncBootstrap(this.accessToken, 100);
    if (!this.running) {
      return;
    }
    this.lastCursor = Math.max(this.lastCursor, response.batch.toCursor);
    await this.callbacks.onBatch(response.batch);
    if (!this.running) {
      return;
    }
    this.lastSuccessfulSyncAtMs = Date.now();
    this.setTransport({
      lastCursor: this.lastCursor,
      lastSuccessfulSyncAt: new Date(this.lastSuccessfulSyncAtMs).toISOString(),
    });
  }

  private connectWebSocket() {
    if (!this.running || this.wsEndpoints.length === 0 || this.transportState.status === "auth_expired") {
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const endpoint = this.resolveWsEndpoint();
    if (!endpoint) {
      return;
    }
    const url = new URL(endpoint);
    url.searchParams.set("access_token", this.accessToken);
    const protocolAuth = `sm.auth.${this.accessToken}`;

    this.setTransport({
      mode: "websocket",
      status: this.lastSuccessfulSyncAtMs > 0 ? "connecting" : "syncing",
      endpoint,
      lastError: null,
      lastCursor: this.lastCursor,
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString(), [protocolAuth, "sm.v1"]);
    } catch (error) {
      this.reportWebsocketIssue(error);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (!this.running || this.ws !== ws) {
        return;
      }
      this.suppressNextWsCloseError = false;
      this.reconnectDelayMs = this.reconnectBackoffMinMs;
      this.reconnectAttempt = 0;
      this.setTransport({
        mode: "websocket",
        status: "connected",
        endpoint,
        lastError: null,
        lastCursor: this.lastCursor,
        reconnectAttempt: 0,
      });
    };

    ws.onmessage = (event) => {
      if (!this.running || this.ws !== ws) {
        return;
      }
      this.handleWsMessage(String(event.data));
    };

    ws.onerror = () => {
      if (!this.running || this.ws !== ws) {
        return;
      }
      this.reportWebsocketIssue();
    };

    ws.onclose = (event) => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (!this.running) {
        return;
      }
      if (this.suppressNextWsCloseError) {
        this.suppressNextWsCloseError = false;
        this.scheduleReconnect();
        return;
      }
      if (this.isLikelyAuthClose(event.code, event.reason)) {
        this.haltForAuthIssue(
          "\u0421\u0435\u0441\u0441\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u0430 \u0438\u043b\u0438 \u0431\u044b\u043b\u0430 \u043e\u0442\u043e\u0437\u0432\u0430\u043d\u0430. \u0412\u043e\u0439\u0434\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
        );
        return;
      }
      this.reportWebsocketIssue(new Error(`ws_close_${event.code}`));
      this.scheduleReconnect();
    };
  }

  private handleWsMessage(raw: string) {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }
    const envelope = (payload as { envelope?: { type?: string; payload?: { cursor?: number } } }).envelope;
    if (!envelope || typeof envelope.type !== "string") {
      return;
    }
    if (envelope.type === "server.sync_available") {
      const hint = typeof envelope.payload?.cursor === "number" ? envelope.payload.cursor : undefined;
      void this.triggerSync(hint).catch((error) => this.handleBackgroundSyncError(error));
      return;
    }
    if (
      envelope.type === "server.notice" &&
      envelope.payload &&
      typeof envelope.payload === "object" &&
      (envelope.payload as { noticeType?: unknown }).noticeType === "typing"
    ) {
      const typedPayload = envelope.payload as {
        conversationId?: unknown;
        accountId?: unknown;
        isTyping?: unknown;
      };
      if (
        typeof typedPayload.conversationId === "string" &&
        typeof typedPayload.accountId === "string" &&
        typeof typedPayload.isTyping === "boolean"
      ) {
        this.callbacks.onTyping?.({
          conversationId: typedPayload.conversationId,
          accountId: typedPayload.accountId,
          isTyping: typedPayload.isTyping,
          at: new Date().toISOString(),
        });
      }
    }
  }

  private scheduleReconnect() {
    if (!this.running || this.wsEndpoints.length === 0 || this.transportState.status === "auth_expired") {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const jitter = Math.floor(Math.random() * Math.max(20, Math.floor(this.reconnectDelayMs * reconnectJitterFactor)));
    const delay = this.reconnectDelayMs + jitter;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectBackoffMaxMs);
    this.reconnectAttempt += 1;
    this.wsIndex = (this.wsIndex + 1) % Math.max(1, this.wsEndpoints.length);

    this.setTransport({
      mode: this.longPollEnabled ? "long_poll" : "websocket",
      status: this.longPollEnabled ? "degraded" : "reconnecting",
      endpoint: this.longPollEnabled ? this.resolvePollEndpoint() : this.resolveWsEndpoint(),
      lastError: null,
      lastCursor: this.lastCursor,
      reconnectAttempt: this.reconnectAttempt,
    });

    this.ensurePollLoop();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  private ensurePollLoop() {
    if (!this.running || !this.longPollEnabled || this.pollLoopPromise) {
      return;
    }
    this.pollLoopPromise = this.runPollLoop().finally(() => {
      this.pollLoopPromise = null;
    });
  }

  private async runPollLoop() {
    while (this.running && this.longPollEnabled) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        await sleep(1000);
        continue;
      }

      const endpoint = this.resolvePollEndpoint();
      this.setTransport({
        mode: "long_poll",
        status: this.wsEndpoints.length > 0 ? "degraded" : "connected",
        endpoint,
        lastError: null,
        lastCursor: this.lastCursor,
      });

      try {
        await this.triggerSync();
        if (!this.running) {
          return;
        }
        this.lastSuccessfulSyncAtMs = Date.now();
        this.consecutivePollFailures = 0;
        this.setTransport({
          mode: this.ws && this.ws.readyState === WebSocket.OPEN ? "websocket" : "long_poll",
          status: this.ws && this.ws.readyState === WebSocket.OPEN ? "connected" : this.wsEndpoints.length > 0 ? "degraded" : "connected",
          endpoint: this.ws && this.ws.readyState === WebSocket.OPEN ? this.resolveWsEndpoint() : endpoint,
          lastError: null,
          lastCursor: this.lastCursor,
          lastSuccessfulSyncAt: new Date(this.lastSuccessfulSyncAtMs).toISOString(),
        });
      } catch (error) {
        if (this.handleAuthFailure(error)) {
          return;
        }
        this.consecutivePollFailures += 1;
        const networkOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        const hasRecentSync = this.lastSuccessfulSyncAtMs > 0 && Date.now() - this.lastSuccessfulSyncAtMs <= recentSyncGraceMs;
        const userMessage = networkOffline
          ? "\u041d\u0435\u0442 \u0441\u0435\u0442\u0438. \u041e\u0436\u0438\u0434\u0430\u0435\u043c \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f."
          : this.toTransportMessage(
              error,
              "\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d. \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0435\u043c \u043f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435.",
            );
        const nextStatus: RuntimeTransportStatus = networkOffline
          ? "offline"
          : hasRecentSync
            ? "degraded"
            : this.wsEndpoints.length > 0
              ? "reconnecting"
              : "offline";

        this.setTransport({
          mode: "long_poll",
          status: nextStatus,
          endpoint,
          lastError: nextStatus === "offline" ? userMessage : null,
          lastCursor: this.lastCursor,
        });
        if (nextStatus === "offline" || this.consecutivePollFailures >= 2) {
          this.emitUserError(userMessage, nextStatus === "offline" ? "poll_offline" : "poll_retrying");
        }
        if (this.pollEndpoints.length > 1) {
          this.pollIndex = (this.pollIndex + 1) % this.pollEndpoints.length;
        }
        await sleep(this.pollBackoffMs());
      }
    }
  }

  private async syncPoll(cursorHint?: number) {
    const cursor = Math.max(this.lastCursor, typeof cursorHint === "number" ? cursorHint : 0);
    const response = await this.api.syncPoll(this.accessToken, {
      cursor,
      timeoutSec: this.longPollTimeoutSec,
      limit: 100,
    });
    if (!this.running) {
      return;
    }
    this.lastCursor = Math.max(this.lastCursor, response.batch.toCursor);
    await this.callbacks.onBatch(response.batch);
    if (!this.running) {
      return;
    }
    this.lastSuccessfulSyncAtMs = Date.now();
    this.setTransport({
      lastCursor: this.lastCursor,
      lastSuccessfulSyncAt: new Date(this.lastSuccessfulSyncAtMs).toISOString(),
    });
  }

  private reportWebsocketIssue(error?: unknown) {
    if (!this.running) {
      return;
    }
    if (this.longPollEnabled) {
      this.setTransport({
        mode: "long_poll",
        status: "degraded",
        endpoint: this.resolvePollEndpoint(),
        lastError: null,
        lastCursor: this.lastCursor,
      });
      return;
    }
    const message = this.toTransportMessage(
      error,
      "\u041f\u043e\u0442\u0435\u0440\u044f\u043d\u043e \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043e\u043c. \u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u043c \u043f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435.",
    );
    this.setTransport({
      mode: "websocket",
      status: "reconnecting",
      endpoint: this.resolveWsEndpoint(),
      lastError: message,
      lastCursor: this.lastCursor,
    });
    this.emitUserError(message, "ws_error");
  }

  private handleBackgroundSyncError(error: unknown) {
    if (this.handleAuthFailure(error)) {
      return;
    }
    if (this.longPollEnabled) {
      this.ensurePollLoop();
      this.setTransport({
        mode: "long_poll",
        status: "degraded",
        endpoint: this.resolvePollEndpoint(),
        lastError: null,
        lastCursor: this.lastCursor,
      });
      return;
    }
    const message = this.toTransportMessage(
      error,
      "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u043c \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044e.",
    );
    this.setTransport({
      mode: "websocket",
      status: "reconnecting",
      endpoint: this.resolveWsEndpoint(),
      lastError: message,
      lastCursor: this.lastCursor,
    });
    this.emitUserError(message, "sync_background");
  }

  private handleAuthFailure(error: unknown): boolean {
    if (!this.isAuthError(error)) {
      return false;
    }
    this.haltForAuthIssue(
      "\u0421\u0435\u0441\u0441\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u0430 \u0438\u043b\u0438 \u0431\u044b\u043b\u0430 \u043e\u0442\u043e\u0437\u0432\u0430\u043d\u0430. \u0412\u043e\u0439\u0434\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
    );
    return true;
  }

  private haltForAuthIssue(message: string) {
    this.running = false;
    this.queuedSyncHint = null;
    this.syncRunning = false;
    this.teardownRuntimeListeners();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.setTransport({
      mode: "none",
      status: "auth_expired",
      endpoint: null,
      lastError: message,
      lastCursor: this.lastCursor,
    });
    this.emitUserError(message, "auth_expired", 0);
    this.callbacks.onAuthExpired?.(message);
  }

  private isAuthError(error: unknown): boolean {
    if (!(error instanceof ApiClientError)) {
      return false;
    }
    if (error.status === 401 || error.status === 403) {
      return true;
    }
    const code = String(error.code ?? "").toLowerCase();
    return (
      code === "unauthorized" ||
      code === "session_invalid" ||
      code === "invalid_token" ||
      code === "invalid_access_token" ||
      code === "auth_required"
    );
  }

  private isLikelyAuthClose(code: number, reason?: string): boolean {
    if (code === 4001 || code === 4401 || code === 4403 || code === 1008) {
      return true;
    }
    const normalizedReason = String(reason ?? "").toLowerCase();
    return normalizedReason.includes("unauthorized") || normalizedReason.includes("token");
  }

  private toTransportMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiClientError) {
      if (error.code === "network_error") {
        return "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u0441\u0435\u0442\u0438 \u0438\u043b\u0438 \u0441\u0435\u0440\u0432\u0435\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442.";
      }
      if (error.message && error.message.trim()) {
        return error.message;
      }
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  private pollBackoffMs(): number {
    const cappedFailures = Math.min(this.consecutivePollFailures, 6);
    return 800 + cappedFailures * 350;
  }

  private resolvePollEndpoint(): string {
    if (this.pollEndpoints.length === 0) {
      return "long-poll";
    }
    return this.pollEndpoints[this.pollIndex % this.pollEndpoints.length];
  }

  private resolveWsEndpoint(): string | null {
    if (this.wsEndpoints.length === 0) {
      return null;
    }
    return this.wsEndpoints[this.wsIndex % this.wsEndpoints.length];
  }

  private bindRuntimeListeners() {
    if (typeof window === "undefined") {
      return;
    }
    this.teardownRuntimeListeners();
    this.onlineHandlerBound = () => {
      if (!this.running || this.transportState.status === "auth_expired") {
        return;
      }
      this.setTransport({ lastError: null });
      this.requestReconnect();
    };
    window.addEventListener("online", this.onlineHandlerBound);

    if (typeof document !== "undefined") {
      this.visibilityHandlerBound = () => {
        if (!this.running || document.visibilityState !== "visible" || this.transportState.status === "auth_expired") {
          return;
        }
        this.requestReconnect();
        if (this.longPollEnabled) {
          void this.triggerSync().catch((error) => this.handleBackgroundSyncError(error));
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandlerBound);
    }
  }

  private teardownRuntimeListeners() {
    if (typeof window !== "undefined" && this.onlineHandlerBound) {
      window.removeEventListener("online", this.onlineHandlerBound);
      this.onlineHandlerBound = null;
    }
    if (typeof document !== "undefined" && this.visibilityHandlerBound) {
      document.removeEventListener("visibilitychange", this.visibilityHandlerBound);
      this.visibilityHandlerBound = null;
    }
  }

  private emitUserError(message: string, fingerprint = message, minIntervalMs = 4000) {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    const now = Date.now();
    if (this.lastErrorFingerprint === fingerprint && now - this.lastErrorAt < minIntervalMs) {
      return;
    }
    this.lastErrorFingerprint = fingerprint;
    this.lastErrorAt = now;
    this.callbacks.onError(normalized);
  }

  private setTransport(next: Partial<RuntimeTransportState>) {
    const derivedLastSuccess =
      next.lastSuccessfulSyncAt === undefined
        ? this.lastSuccessfulSyncAtMs > 0
          ? new Date(this.lastSuccessfulSyncAtMs).toISOString()
          : this.transportState.lastSuccessfulSyncAt
        : next.lastSuccessfulSyncAt;

    this.transportState = {
      ...this.transportState,
      ...next,
      lastSuccessfulSyncAt: derivedLastSuccess ?? null,
      reconnectAttempt: next.reconnectAttempt ?? this.reconnectAttempt,
      updatedAt: new Date().toISOString(),
    };
    this.callbacks.onTransport(this.transportState);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
