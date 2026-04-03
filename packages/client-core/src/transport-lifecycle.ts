import type { TransportLifecycleEvent, TransportLifecycleState } from "@project/shared-types";

export interface TransportLifecycleSnapshot {
  state: TransportLifecycleState;
  recentEvents: TransportLifecycleEvent[];
  updatedAt: string;
}

const maxRecentEvents = 20;

export function createInitialTransportLifecycle(): TransportLifecycleSnapshot {
  return {
    state: "bootstrapping",
    recentEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

export function transitionTransportLifecycle(
  current: TransportLifecycleSnapshot,
  event: TransportLifecycleEvent,
): TransportLifecycleSnapshot {
  const nextState = resolveNextState(current.state, event);
  const recentEvents = [...current.recentEvents, event].slice(-maxRecentEvents);
  return {
    state: nextState,
    recentEvents,
    updatedAt: new Date().toISOString(),
  };
}

function resolveNextState(current: TransportLifecycleState, event: TransportLifecycleEvent): TransportLifecycleState {
  switch (event) {
    case "config_loaded":
      return "unauthenticated";
    case "auth_restored":
      return "restoring_session";
    case "token_refreshed":
      return "connecting";
    case "ws_connected":
      return "connected";
    case "ws_disconnected":
      return current === "forbidden" ? "forbidden" : "degraded";
    case "poll_fallback_entered":
      return "degraded";
    case "resync_completed":
      return current === "forbidden" ? "forbidden" : "connected";
    case "online_changed":
    case "visibility_changed":
    case "transport_leader_changed":
      return current;
    default:
      return current;
  }
}
