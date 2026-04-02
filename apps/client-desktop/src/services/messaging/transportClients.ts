import { logger } from "@/services/logger";
import { appConfig } from "@/lib/config";

export interface WebSocketTransportHandlers {
  onConnected: (endpoint: string) => void;
  onDisconnected: (endpoint: string, reason?: string) => void;
  onError: (endpoint: string, errorMessage: string) => void;
  onSyncAvailable: (cursor: number) => void;
}

interface ServerEnvelopePayload {
  envelope?: {
    type?: string;
    payload?: {
      cursor?: number;
      code?: string;
      message?: string;
    };
  };
}

export class WebSocketTransport {
  private ws: WebSocket | null = null;
  private endpoint: string | null = null;

  constructor(private readonly handlers: WebSocketTransportHandlers) {}

  connect(endpoint: string, accessToken: string) {
    this.disconnect();

    const url = new URL(endpoint);
    if (appConfig.wsQueryTokenFallback) {
      url.searchParams.set("access_token", accessToken);
    }
    const protocolAuth = `sm.auth.${accessToken}`;

    this.endpoint = endpoint;
    this.ws = new WebSocket(url.toString(), [protocolAuth, "sm.v1"]);

    this.ws.onopen = () => {
      this.handlers.onConnected(endpoint);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(endpoint, event.data);
    };

    this.ws.onerror = () => {
      this.handlers.onError(endpoint, "websocket transport error");
    };

    this.ws.onclose = (event) => {
      const reason = event.reason?.trim();
      const composedReason = reason ? `${reason} (code=${event.code})` : `code=${event.code}`;
      this.handlers.onDisconnected(endpoint, composedReason);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.endpoint = null;
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  isConnecting() {
    return this.ws?.readyState === WebSocket.CONNECTING;
  }

  currentEndpoint() {
    return this.endpoint;
  }

  private handleMessage(endpoint: string, rawData: unknown) {
    try {
      const payload = JSON.parse(String(rawData)) as ServerEnvelopePayload;
      const envelopeType = payload.envelope?.type;
      if (envelopeType === "server.sync_available" && typeof payload.envelope?.payload?.cursor === "number") {
        this.handlers.onSyncAvailable(payload.envelope.payload.cursor);
        return;
      }
      if (envelopeType === "server.error") {
        const message = payload.envelope?.payload?.message ?? "server websocket error";
        this.handlers.onError(endpoint, message);
      }
    } catch (error) {
      logger.debug("failed to parse websocket message payload", { endpoint, error: String(error) });
    }
  }
}
