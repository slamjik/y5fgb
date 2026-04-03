export type TransportMode = "websocket" | "long-poll";
export type TransportStatus = "offline" | "connecting" | "online" | "degraded";

export interface TransportStateSnapshot {
  mode: TransportMode | "none";
  status: TransportStatus;
  endpoint: string | null;
  cursor: number;
  queueSize: number;
  updatedAt: string;
}

export interface TransportEndpoint {
  id: string;
  url: string;
  mode: TransportMode;
  priority: number;
  enabled: boolean;
}

export interface RealtimeClient {
  connect(accessToken: string): Promise<void>;
  disconnect(): void;
  snapshot(): TransportStateSnapshot;
}

