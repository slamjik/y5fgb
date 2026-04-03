import type { SessionClass, SessionPersistenceMode } from "@project/shared-types";

export interface SessionPolicy {
  sessionClass: SessionClass;
  persistence: SessionPersistenceMode;
  allowRemembered: boolean;
}

export function normalizeSessionPersistenceMode(value: string | undefined | null): SessionPersistenceMode {
  if (value === "remembered") {
    return "remembered";
  }
  return "ephemeral";
}

export function toRememberedAllowed(policy: SessionPolicy): boolean {
  return policy.allowRemembered && policy.persistence === "remembered";
}
