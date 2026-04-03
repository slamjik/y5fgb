import {
  buildFallbackConfig,
  buildServerConfigEndpoint,
  normalizeApiBase,
  normalizeApiPrefix,
  normalizeServerInput,
  normalizeWsURL,
  parseServerConfigPayload,
  ServerConfigError,
} from "@project/client-core";

import { appConfig } from "@/lib/config";

const SERVER_CONFIG_STORAGE_KEY = "secure-messenger-server-config-v1";
const REQUEST_TIMEOUT_MS = 7000;

type PersistedServerConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  apiPrefix: string;
  inputHost: string;
  savedAt: string;
};

export type ActiveServerConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  apiPrefix: string;
  source: "saved" | "env";
  inputHost?: string;
};

export { ServerConfigError as ServerConnectionError };

export async function connectToServer(input: string): Promise<ActiveServerConfig> {
  const normalized = normalizeServerInput(input);
  const discovered = await discoverServerConfig(normalized);
  persistServerConfig(discovered);

  return {
    apiBaseUrl: discovered.apiBaseUrl,
    wsUrl: discovered.wsUrl,
    apiPrefix: discovered.apiPrefix,
    source: "saved",
    inputHost: discovered.inputHost,
  };
}

export function clearServerConfig() {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(SERVER_CONFIG_STORAGE_KEY);
}

export function hasStoredServerConfig(): boolean {
  return getStoredServerConfig() !== null;
}

export function getActiveServerConfig(): ActiveServerConfig {
  const stored = getStoredServerConfig();
  if (stored) {
    return {
      apiBaseUrl: stored.apiBaseUrl,
      wsUrl: stored.wsUrl,
      apiPrefix: stored.apiPrefix,
      source: "saved",
      inputHost: stored.inputHost,
    };
  }

  return {
    apiBaseUrl: appConfig.apiBaseUrl,
    wsUrl: appConfig.wsUrl,
    apiPrefix: appConfig.apiPrefix,
    source: "env",
  };
}

export function getServerHostForDisplay(config = getActiveServerConfig()): string {
  try {
    const parsed = new URL(config.apiBaseUrl);
    return parsed.host;
  } catch {
    return config.apiBaseUrl;
  }
}

export function getServerInputDefaultValue(): string {
  const active = getActiveServerConfig();
  if (active.inputHost && active.inputHost.trim()) {
    return active.inputHost;
  }
  return getServerHostForDisplay(active);
}

function persistServerConfig(config: PersistedServerConfig) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function getStoredServerConfig(): PersistedServerConfig | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(SERVER_CONFIG_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedServerConfig>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.apiBaseUrl !== "string" ||
      typeof parsed.wsUrl !== "string" ||
      typeof parsed.apiPrefix !== "string" ||
      typeof parsed.inputHost !== "string"
    ) {
      return null;
    }

    return {
      apiBaseUrl: normalizeApiBase(parsed.apiBaseUrl),
      wsUrl: normalizeWsURL(parsed.wsUrl),
      apiPrefix: normalizeApiPrefix(parsed.apiPrefix),
      inputHost: parsed.inputHost.trim(),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function discoverServerConfig(normalizedInput: { origin: string; inputHost: string }): Promise<PersistedServerConfig> {
  const configURL = buildServerConfigEndpoint(normalizedInput.origin);

  let response: Response;
  try {
    response = await fetchWithTimeout(configURL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new ServerConfigError("connection_failed", error instanceof Error ? error.message : "connection failed");
  }

  if (response.status === 404) {
    const fallback = buildFallbackConfig(normalizedInput.origin);
    return {
      ...fallback,
      inputHost: normalizedInput.inputHost,
      savedAt: new Date().toISOString(),
    };
  }

  if (!response.ok) {
    throw new ServerConfigError("connection_failed", "server config endpoint is unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ServerConfigError("config_invalid", "server config response is not valid json");
  }

  const parsed = parseServerConfigPayload(payload);
  return {
    ...parsed,
    inputHost: normalizedInput.inputHost,
    savedAt: new Date().toISOString(),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

