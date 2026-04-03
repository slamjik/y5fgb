import { invoke } from "@tauri-apps/api/core";
import { defaultStorageSegmentationPolicy, isSensitiveStorageKey } from "@project/client-core";
import { createBrowserLocalStorageAdapter, isTauriDesktopRuntime } from "@project/platform-adapters";

import { logger } from "@/services/logger";

const fallbackPrefix = "secure-messenger-fallback:";
const browserFallbackStorage = createBrowserLocalStorageAdapter(fallbackPrefix);

async function setStrict(key: string, value: string): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  await invoke("secure_store_set", { key, value });
}

async function getStrict(key: string): Promise<string | null> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  try {
    const value = await invoke<string | null>("secure_store_get", { key });
    return value ?? null;
  } catch (error) {
    if (isMissingSecureEntryError(error)) {
      return null;
    }
    throw error;
  }
}

async function deleteStrict(key: string): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("secure keyring is unavailable outside tauri runtime");
  }
  try {
    await invoke("secure_store_delete", { key });
  } catch (error) {
    if (isMissingSecureEntryError(error)) {
      return;
    }
    throw error;
  }
}

export const secureStorage = {
  async set(key: string, value: string): Promise<void> {
    if (isSensitiveKey(key)) {
      await setStrict(key, value);
      return;
    }

    if (isTauriDesktopRuntime()) {
      try {
        await setStrict(key, value);
        return;
      } catch (error) {
        logger.warn("failed to write keyring value, using fallback storage", { key, error });
      }
    }

    await browserFallbackStorage.set(key, value);
  },

  async get(key: string): Promise<string | null> {
    if (isSensitiveKey(key)) {
      return getStrict(key);
    }

    if (isTauriDesktopRuntime()) {
      try {
        return await getStrict(key);
      } catch (error) {
        logger.warn("failed to read keyring value, using fallback storage", { key, error });
      }
    }

    return browserFallbackStorage.get(key);
  },

  async delete(key: string): Promise<void> {
    if (isSensitiveKey(key)) {
      await deleteStrict(key);
      return;
    }

    if (isTauriDesktopRuntime()) {
      try {
        await deleteStrict(key);
      } catch (error) {
        logger.warn("failed to delete keyring value, using fallback storage", { key, error });
      }
    }

    await browserFallbackStorage.delete(key);
  },

  setStrict,
  getStrict,
  deleteStrict,
};

function isSensitiveKey(key: string): boolean {
  return isSensitiveStorageKey(key, defaultStorageSegmentationPolicy);
}

function isMissingSecureEntryError(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return (
    message.includes("no entry") ||
    message.includes("not found") ||
    message.includes("no matching entry") ||
    message.includes("cannot find") ||
    message.includes("element not found") ||
    message.includes("file specified")
  );
}

