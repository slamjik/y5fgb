import { invoke } from "@tauri-apps/api/core";

import { logger } from "@/services/logger";

const fallbackPrefix = "secure-messenger-fallback:";
const strictSensitivePrefixes = ["auth.", "identity.", "messaging.store.key."];

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function setStrict(key: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  await invoke("secure_store_set", { key, value });
}

async function getStrict(key: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  const value = await invoke<string | null>("secure_store_get", { key });
  return value ?? null;
}

async function deleteStrict(key: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  await invoke("secure_store_delete", { key });
}

export const secureStorage = {
  async set(key: string, value: string): Promise<void> {
    if (isSensitiveKey(key)) {
      await setStrict(key, value);
      return;
    }

    if (isTauriRuntime()) {
      try {
        await setStrict(key, value);
        return;
      } catch (error) {
        logger.warn("failed to write keyring value, using fallback storage", { key, error });
      }
    }

    localStorage.setItem(fallbackPrefix + key, value);
  },

  async get(key: string): Promise<string | null> {
    if (isSensitiveKey(key)) {
      return getStrict(key);
    }

    if (isTauriRuntime()) {
      try {
        return await getStrict(key);
      } catch (error) {
        logger.warn("failed to read keyring value, using fallback storage", { key, error });
      }
    }

    return localStorage.getItem(fallbackPrefix + key);
  },

  async delete(key: string): Promise<void> {
    if (isSensitiveKey(key)) {
      await deleteStrict(key);
      return;
    }

    if (isTauriRuntime()) {
      try {
        await deleteStrict(key);
      } catch (error) {
        logger.warn("failed to delete keyring value, using fallback storage", { key, error });
      }
    }

    localStorage.removeItem(fallbackPrefix + key);
  },

  setStrict,
  getStrict,
  deleteStrict,
};

function isSensitiveKey(key: string): boolean {
  return strictSensitivePrefixes.some((prefix) => key.startsWith(prefix));
}
