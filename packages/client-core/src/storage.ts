export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SensitiveStorage extends KeyValueStorage {
  readonly requiresSecureContext: boolean;
}

export interface StorageSegmentationPolicy {
  sensitivePrefixes: string[];
  volatilePrefixes: string[];
}

export function isSensitiveStorageKey(key: string, policy: StorageSegmentationPolicy): boolean {
  return policy.sensitivePrefixes.some((prefix) => key.startsWith(prefix));
}

export const defaultStorageSegmentationPolicy: StorageSegmentationPolicy = {
  sensitivePrefixes: ["auth.", "identity.", "messaging.store.key."],
  volatilePrefixes: ["pending.", "2fa.challenge.", "recovery.codes."],
};

