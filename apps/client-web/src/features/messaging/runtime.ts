import type { SyncBatchDTO } from "@project/protocol";

import type { WebApiClient } from "../../shared/api/client";

export type RuntimeTransportMode = "none" | "websocket" | "long_poll";
export type RuntimeTransportStatus = "connecting" | "connected" | "degraded" | "offline" | "reconnecting";

export interface RuntimeTransportState {
  mode: RuntimeTransportMode;
  status: RuntimeTransportStatus;
  endpoint: string | null;
  lastError: string | null;
  lastCursor: number;
  updatedAt: string;
}

type RuntimeCallbacks = {
  onBatch: (batch: SyncBatchDTO) => Promise<void> | void;
  onTransport: (state: RuntimeTransportState) => void;
  onError: (message: string) => void;
};

const defaultTransportState: RuntimeTransportState = {
  mode: "none",
  status: "connecting",
  endpoint: null,
  lastError: null,
  lastCursor: 0,
  updatedAt: new Date().toISOString(),
};

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

  private pollLoopPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private syncRunning = false;
  private queuedSyncHint: number | null = null;
  private lastCursor = 0;

  private transportState: RuntimeTransportState = { ...defaultTransportState };

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
    this.setTransport({
      mode: "none",
      status: "connecting",
      endpoint: null,
      lastError: null,
      lastCursor: this.lastCursor,
    });

    await this.configureTransport();
    await this.bootstrap();
    this.connectWebSocket();
    this.ensurePollLoop();
  }

  stop() {
    this.running = false;
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
    });
  }

  async triggerSync(cursorHint?: number): Promise<void> {
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
    this.lastCursor = Math.max(this.lastCursor, response.batch.toCursor);
    await this.callbacks.onBatch(response.batch);
    this.setTransport({ lastCursor: this.lastCursor });
  }

  private connectWebSocket() {
    if (!this.running || this.wsEndpoints.length === 0) {
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const endpoint = this.wsEndpoints[this.wsIndex % this.wsEndpoints.length];
    const url = new URL(endpoint);
    url.searchParams.set("access_token", this.accessToken);
    const protocolAuth = `sm.auth.${this.accessToken}`;

    this.setTransport({
      mode: "websocket",
      status: "connecting",
      endpoint,
      lastError: null,
      lastCursor: this.lastCursor,
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString(), [protocolAuth, "sm.v1"]);
    } catch (error) {
      this.reportWebsocketError(error instanceof Error ? error.message : "Не удалось инициализировать WebSocket.");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelayMs = this.reconnectBackoffMinMs;
      this.setTransport({
        mode: "websocket",
        status: "connected",
        endpoint,
        lastError: null,
        lastCursor: this.lastCursor,
      });
    };

    ws.onmessage = (event) => {
      this.handleWsMessage(String(event.data));
    };

    ws.onerror = () => {
      this.reportWebsocketError("Ошибка WebSocket соединения.");
    };

    ws.onclose = (event) => {
      if (!this.running) {
        return;
      }
      const reason = event.reason?.trim() ? `${event.reason} (code=${event.code})` : `code=${event.code}`;
      this.reportWebsocketError(`WebSocket отключён (${reason}).`);
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
      void this.triggerSync(hint);
    }
  }

  private scheduleReconnect() {
    if (!this.running || this.wsEndpoints.length === 0) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const jitter = Math.floor(Math.random() * Math.max(20, Math.floor(this.reconnectDelayMs * 0.2)));
    const delay = this.reconnectDelayMs + jitter;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectBackoffMaxMs);
    this.wsIndex = (this.wsIndex + 1) % Math.max(1, this.wsEndpoints.length);

    this.setTransport({
      mode: this.longPollEnabled ? "long_poll" : "websocket",
      status: this.longPollEnabled ? "degraded" : "reconnecting",
      endpoint: this.longPollEnabled ? this.resolvePollEndpoint() : this.wsEndpoints[this.wsIndex],
      lastCursor: this.lastCursor,
    });

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
        lastCursor: this.lastCursor,
      });

      try {
        await this.syncPoll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ошибка long-poll синхронизации.";
        this.setTransport({
          mode: "long_poll",
          status: "offline",
          endpoint,
          lastError: message,
          lastCursor: this.lastCursor,
        });
        this.callbacks.onError(message);
        if (this.pollEndpoints.length > 1) {
          this.pollIndex = (this.pollIndex + 1) % this.pollEndpoints.length;
        }
        await sleep(1200);
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
    this.lastCursor = Math.max(this.lastCursor, response.batch.toCursor);
    await this.callbacks.onBatch(response.batch);
    this.setTransport({ lastCursor: this.lastCursor });
  }

  private reportWebsocketError(message: string) {
    this.setTransport({
      mode: "websocket",
      status: this.longPollEnabled ? "degraded" : "offline",
      lastError: message,
      lastCursor: this.lastCursor,
    });
    this.callbacks.onError(message);
  }

  private resolvePollEndpoint(): string {
    if (this.pollEndpoints.length === 0) {
      return "long-poll";
    }
    return this.pollEndpoints[this.pollIndex % this.pollEndpoints.length];
  }

  private setTransport(next: Partial<RuntimeTransportState>) {
    this.transportState = {
      ...this.transportState,
      ...next,
      updatedAt: new Date().toISOString(),
    };
    this.callbacks.onTransport(this.transportState);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}


