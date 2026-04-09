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
import type { DeviceMaterial, SavedServer, SessionMode, SessionState } from "./types";

export const serverStorageKey = "secure-messenger-web-server-v3";
export const refreshTokenStorageKey = "secure-messenger-web-refresh-token";
export const sessionModeStorageKey = "secure-messenger-web-session-mode";
export const syncCursorStorageKey = "secure-messenger-web-sync-cursor";
const deviceMaterialStorageKey = "secure-messenger-web-device-material-v1";
const deviceMaterialSessionKey = "secure-messenger-web-device-material-session-v1";

const safeStoreTimeoutMs = 1500;
const serverConfigFetchTimeoutMs = 8000;

export const secretVault = createMemorySecretVault();
export const persistentStore = createIndexedDbStateStore();
export const runtimePlatform = createRuntimePlatformAdapter();

type StoredDeviceMaterial = {
  publicKey: string;
  privateKey: string;
  name: string;
  platform: string;
  deviceId?: string;
};

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

export async function loadPersistedDeviceMaterial(expectedDeviceId?: string): Promise<DeviceMaterial | null> {
  const fromSession = parseStoredDeviceMaterial(readSessionStorage(deviceMaterialSessionKey), expectedDeviceId);
  if (fromSession) {
    return fromSession;
  }
  const fromPersistent = parseStoredDeviceMaterial(await safeStoreGet(deviceMaterialStorageKey), expectedDeviceId);
  if (fromPersistent) {
    return fromPersistent;
  }
  return null;
}

export async function savePersistedDeviceMaterial(
  device: DeviceMaterial,
  mode: SessionMode,
  deviceId?: string,
): Promise<void> {
  const payload: StoredDeviceMaterial = {
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    name: device.name,
    platform: device.platform,
    ...(deviceId ? { deviceId } : {}),
  };
  const serialized = JSON.stringify(payload);
  writeSessionStorage(deviceMaterialSessionKey, serialized);
  if (mode === "remembered") {
    await safeStoreSet(deviceMaterialStorageKey, serialized);
  } else {
    await safeStoreDelete(deviceMaterialStorageKey);
  }
}

export async function clearPersistedDeviceMaterial(): Promise<void> {
  removeSessionStorage(deviceMaterialSessionKey);
  await safeStoreDelete(deviceMaterialStorageKey);
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
    if (error.code === "invalid_credentials") return "Invalid email or password.";
    if (error.code === "two_fa_required") return "Two-factor authentication code is required.";
    if (error.code === "account_already_exists") return "Account already exists.";
    if (error.code === "fingerprint_mismatch") {
      return "Device key conflict. Clear site data and sign in again.";
    }
    if (error.code === "device_not_approved") {
      return "Device is not approved yet. Complete device approval and retry.";
    }
    if (error.code === "validation_error") {
      const details = error.details && typeof error.details === "object" ? error.details : null;
      const passwordDetail = details && typeof details.password === "string" ? details.password : "";
      const emailDetail = details && typeof details.email === "string" ? details.email : "";
      const deviceNameDetail = details && typeof details.deviceName === "string" ? details.deviceName : "";
      const deviceMaterialDetail =
        details && typeof details.publicDeviceMaterial === "string" ? details.publicDeviceMaterial : "";

      if (passwordDetail.includes("at least 10")) {
        return "Password must be at least 10 characters.";
      }
      if (passwordDetail) {
        return "Invalid password: " + passwordDetail;
      }
      if (emailDetail.includes("required")) {
        return "Email is required.";
      }
      if (emailDetail.includes("invalid")) {
        return "Check email format.";
      }
      if (emailDetail) {
        return "Invalid email: " + emailDetail;
      }
      if (deviceNameDetail || deviceMaterialDetail) {
        return "Device payload is invalid. Refresh and try again.";
      }

      for (const value of Object.values(details ?? {})) {
        if (typeof value === "string" && value.trim()) return value;
      }
      return "Invalid registration data.";
    }
    if (error.code === "attachment_upload_failed") {
      const details = error.details && typeof error.details === "object" ? error.details : null;
      const maxBytes = details && typeof details.maxBytes === "number" ? details.maxBytes : null;
      const message = (error.message || "").toLowerCase();
      if (maxBytes && Number.isFinite(maxBytes) && maxBytes > 0) {
        const limitMB = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
        return `Attachment is too large. Maximum size is ${limitMB} MB.`;
      }
      if (message.includes("mime type")) {
        return "Unsupported photo format. Try JPEG, PNG, WEBP, HEIC, or AVIF.";
      }
      if (message.includes("checksum")) {
        return "Upload integrity check failed. Please try attaching the file again.";
      }
      return "Unable to upload attachment.";
    }
    if (error.code === "attachment_download_failed") return "Unable to download attachment.";
    if (error.code === "network_error") return "Unable to connect to server.";
    return error.message || "Request failed.";
  }
  if (error instanceof Error) return error.message || "Unexpected error.";
  return "Unexpected error.";
}

function parseStoredDeviceMaterial(raw: string | null, expectedDeviceId?: string): DeviceMaterial | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDeviceMaterial>;
    if (
      !parsed ||
      typeof parsed.publicKey !== "string" ||
      typeof parsed.privateKey !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.platform !== "string"
    ) {
      return null;
    }
    if (expectedDeviceId && parsed.deviceId && parsed.deviceId !== expectedDeviceId) {
      return null;
    }
    return {
      publicKey: parsed.publicKey,
      privateKey: parsed.privateKey,
      name: parsed.name,
      platform: parsed.platform,
    };
  } catch {
    return null;
  }
}

function readSessionStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function removeSessionStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // noop
  }
}
