export type MultiTabEventType = "logout" | "session_invalidated" | "transport_leader_changed" | "session_refreshed";

export interface MultiTabEventPayload {
  type: MultiTabEventType;
  tabId: string;
  at: string;
  data?: Record<string, unknown>;
}

type Handler = (event: MultiTabEventPayload) => void;

export interface MultiTabCoordinator {
  tabId: string;
  publish(event: Omit<MultiTabEventPayload, "tabId" | "at">): void;
  subscribe(handler: Handler): () => void;
  close(): void;
}

const CHANNEL_NAME = "secure-messenger-web-session";

export function createMultiTabCoordinator(): MultiTabCoordinator {
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const handlers = new Set<Handler>();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;

  const onMessage = (payload: MultiTabEventPayload) => {
    if (!payload || payload.tabId === tabId) {
      return;
    }
    handlers.forEach((handler) => handler(payload));
  };

  if (channel) {
    channel.onmessage = (event: MessageEvent) => onMessage(event.data as MultiTabEventPayload);
  }

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== CHANNEL_NAME || !event.newValue) {
      return;
    }
    try {
      onMessage(JSON.parse(event.newValue) as MultiTabEventPayload);
    } catch {
      // ignore malformed storage relay payload
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", storageHandler);
  }

  return {
    tabId,
    publish(event) {
      const payload: MultiTabEventPayload = {
        ...event,
        tabId,
        at: new Date().toISOString(),
      };
      if (channel) {
        channel.postMessage(payload);
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(CHANNEL_NAME, JSON.stringify(payload));
      }
    },
    subscribe(handler: Handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      handlers.clear();
      channel?.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", storageHandler);
      }
    },
  };
}
