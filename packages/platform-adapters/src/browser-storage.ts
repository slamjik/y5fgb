import type { KeyValueStorage } from "@project/client-core";

export function createBrowserLocalStorageAdapter(prefix: string): KeyValueStorage {
  return {
    async get(key: string): Promise<string | null> {
      if (typeof localStorage === "undefined") {
        return null;
      }
      return localStorage.getItem(`${prefix}${key}`);
    },
    async set(key: string, value: string): Promise<void> {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(`${prefix}${key}`, value);
    },
    async delete(key: string): Promise<void> {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.removeItem(`${prefix}${key}`);
    },
  };
}

