export type StorageClass =
  | "volatile_secrets"
  | "session_tokens"
  | "sync_state"
  | "encrypted_cache"
  | "attachment_meta"
  | "preferences"
  | "identity_state";

export interface StorageCleanupPolicy {
  onLogout: StorageClass[];
  onSessionExpiry: StorageClass[];
  onAccountSwitch: StorageClass[];
}

export const defaultStorageCleanupPolicy: StorageCleanupPolicy = {
  onLogout: ["volatile_secrets", "session_tokens", "sync_state", "encrypted_cache", "attachment_meta", "identity_state"],
  onSessionExpiry: ["volatile_secrets", "session_tokens", "sync_state"],
  onAccountSwitch: ["volatile_secrets", "session_tokens", "sync_state", "encrypted_cache", "attachment_meta", "identity_state"],
};
