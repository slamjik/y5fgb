import {
  buildFallbackConfig,
  buildServerConfigEndpoint,
  type ServerBootstrapConfig,
  parseServerConfigPayload,
} from "@project/client-core";
import {
  createIndexedDbStateStore,
  createMemorySecretVault,
  createRuntimePlatformAdapter,
} from "@project/platform-adapters";

import { ApiClientError, WebApiClient } from "../shared/api/client";
import type { SavedServer, SessionMode, SessionState } from "./types";

export const serverStorageKey = "secure-messenger-web-server-v3";
export const refreshTokenStorageKey = "secure-messenger-web-refresh-token";
export const sessionModeStorageKey = "secure-messenger-web-session-mode";
export const syncCursorStorageKey = "secure-messenger-web-sync-cursor";

const safeStoreTimeoutMs = 1500;
const serverConfigFetchTimeoutMs = 8000;

export const secretVault = createMemorySecretVault();
export const persistentStore = createIndexedDbStateStore();
export const runtimePlatform = createRuntimePlatformAdapter();

export async function fetchServerConfig(origin: string): Promise<ServerBootstrapConfig> {
  const endpoint = buildServerConfigEndpoint(origin);
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), serverConfigFetchTimeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "GET", signal: controller.signal });
  } catch {
    throw new Error("Не удалось подключиться к серверу.");
  } finally {
    window.clearTimeout(timeoutHandle);
  }
  if (response.status === 404) return buildFallbackConfig(origin);
  if (!response.ok) throw new Error("Сервер вернул некорректный ответ конфигурации.");
  const payload = await response.json().catch(() => null);
  return parseServerConfigPayload(payload);
}

export function detectDefaultServerInput(): string {
  if (typeof window === "undefined") {
    return "http://localhost:8080";
  }
  if (!window.location.origin || window.location.origin === "null") {
    return "http://localhost:8080";
  }
  return window.location.origin;
}

export function loadSavedServer(): SavedServer | null {
  try {
    const raw = localStorage.getItem(serverStorageKey);
    if (!raw) return null;
    return JSON.parse(raw) as SavedServer;
  } catch {
    return null;
  }
}

export async function restoreSession(config: ServerBootstrapConfig, mode: SessionMode): Promise<SessionState | null> {
  let refreshToken = await secretVault.get(refreshTokenStorageKey);
  if (!refreshToken && mode === "remembered") refreshToken = await safeStoreGet(refreshTokenStorageKey);
  if (!refreshToken) return null;

  const api = new WebApiClient(config);
  try {
    const refreshed = await api.refreshWeb(refreshToken);
    const profile = await api.webSession(refreshed.tokens.accessToken);
    await secretVault.set(refreshTokenStorageKey, refreshed.tokens.refreshToken);
    if (mode === "remembered") await safeStoreSet(refreshTokenStorageKey, refreshed.tokens.refreshToken);
    return {
      accessToken: refreshed.tokens.accessToken,
      refreshToken: refreshed.tokens.refreshToken,
      accountId: refreshed.accountId as string,
      email: profile.email,
      deviceId: refreshed.device.id as string,
    };
  } catch {
    await clearAuthState();
    return null;
  }
}

export async function clearAuthState() {
  await secretVault.delete(refreshTokenStorageKey);
  await safeStoreDelete(refreshTokenStorageKey);
  await safeStoreDelete(syncCursorStorageKey);
}

export function browserDeviceName(): string {
  if (typeof navigator === "undefined") return "Web Browser";
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("firefox")) return "Firefox Browser";
  if (userAgent.includes("edg")) return "Edge Browser";
  if (userAgent.includes("chrome")) return "Chrome Browser";
  if (userAgent.includes("safari")) return "Safari Browser";
  return "Web Browser";
}

export function normalizeSessionMode(value: string | null): SessionMode | null {
  if (value === "ephemeral" || value === "remembered") return value;
  return null;
}

export async function safeStoreGet(key: string): Promise<string | null> {
  try {
    return await withTimeout(persistentStore.get(key), safeStoreTimeoutMs, null);
  } catch {
    return null;
  }
}

export async function safeStoreSet(key: string, value: string): Promise<void> {
  try {
    await withTimeout(
      persistentStore
        .set(key, value)
        .then(() => undefined)
        .catch(() => undefined),
      safeStoreTimeoutMs,
      undefined,
    );
  } catch {
    // noop
  }
}

export async function safeStoreDelete(key: string): Promise<void> {
  try {
    await withTimeout(
      persistentStore
        .delete(key)
        .then(() => undefined)
        .catch(() => undefined),
      safeStoreTimeoutMs,
      undefined,
    );
  } catch {
    // noop
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        handle = setTimeout(() => resolve(fallback), Math.max(250, timeoutMs));
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

export function toUserError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "invalid_credentials") return "Неверный email или пароль.";
    if (error.code === "two_fa_required") return "Нужен код двухфакторной аутентификации.";
    if (error.code === "account_already_exists") return "Аккаунт уже существует.";
    if (error.code === "fingerprint_mismatch") return "Конфликт ключа устройства. Очистите данные сайта и войдите снова.";
    if (error.code === "device_not_approved") return "Устройство не подтверждено. Завершите подтверждение входа.";
    if (error.code === "network_error") return "Не удалось подключиться к серверу.";
    return error.message || "Ошибка запроса.";
  }
  if (error instanceof Error) return error.message || "Произошла ошибка.";
  return "Произошла ошибка.";
}

