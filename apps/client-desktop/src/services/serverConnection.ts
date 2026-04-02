import { appConfig } from "@/lib/config";

const SERVER_CONFIG_STORAGE_KEY = "secure-messenger-server-config-v1";
const DEFAULT_API_PREFIX = "/api/v1";
const DEFAULT_WS_PATH = "/ws";
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

export class ServerConnectionError extends Error {
  readonly code: "invalid_input" | "connection_failed" | "config_invalid";

  constructor(code: "invalid_input" | "connection_failed" | "config_invalid", message: string) {
    super(message);
    this.code = code;
  }
}

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
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (
      typeof parsed.apiBaseUrl !== "string" ||
      typeof parsed.wsUrl !== "string" ||
      typeof parsed.apiPrefix !== "string" ||
      typeof parsed.inputHost !== "string"
    ) {
      return null;
    }

    const apiBaseUrl = normalizeApiBase(parsed.apiBaseUrl);
    const wsUrl = normalizeWsURL(parsed.wsUrl);
    const apiPrefix = normalizeApiPrefix(parsed.apiPrefix);

    return {
      apiBaseUrl,
      wsUrl,
      apiPrefix,
      inputHost: parsed.inputHost.trim(),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function discoverServerConfig(normalizedInput: { origin: string; inputHost: string }): Promise<PersistedServerConfig> {
  const configURL = new URL(`${DEFAULT_API_PREFIX}/config`, normalizedInput.origin).toString();

  let response: Response;
  try {
    response = await fetchWithTimeout(configURL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new ServerConnectionError("connection_failed", error instanceof Error ? error.message : "connection failed");
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
    throw new ServerConnectionError("connection_failed", "server config endpoint is unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ServerConnectionError("config_invalid", "server config response is not valid json");
  }

  const parsed = parseServerConfigPayload(payload);
  return {
    ...parsed,
    inputHost: normalizedInput.inputHost,
    savedAt: new Date().toISOString(),
  };
}

function parseServerConfigPayload(payload: unknown): Pick<PersistedServerConfig, "apiBaseUrl" | "wsUrl" | "apiPrefix"> {
  if (!payload || typeof payload !== "object") {
    throw new ServerConnectionError("config_invalid", "server config response has invalid shape");
  }

  const source = payload as Record<string, unknown>;
  if (
    typeof source.api_base !== "string" ||
    typeof source.ws_url !== "string" ||
    typeof source.api_prefix !== "string"
  ) {
    throw new ServerConnectionError("config_invalid", "server config response has missing required fields");
  }

  return {
    apiBaseUrl: normalizeApiBase(source.api_base),
    wsUrl: normalizeWsURL(source.ws_url),
    apiPrefix: normalizeApiPrefix(source.api_prefix),
  };
}

function normalizeServerInput(input: string): { origin: string; inputHost: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ServerConnectionError("invalid_input", "server input is empty");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ServerConnectionError("invalid_input", "server input is not a valid url");
  }

  if (!parsed.hostname) {
    throw new ServerConnectionError("invalid_input", "server hostname is required");
  }

  return {
    origin: parsed.origin,
    inputHost: parsed.host,
  };
}

function buildFallbackConfig(apiBaseOrigin: string): Pick<PersistedServerConfig, "apiBaseUrl" | "wsUrl" | "apiPrefix"> {
  const apiBase = normalizeApiBase(apiBaseOrigin);
  const parsed = new URL(apiBase);
  const wsScheme = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${parsed.host}${DEFAULT_WS_PATH}`;

  return {
    apiBaseUrl: apiBase,
    wsUrl: normalizeWsURL(wsUrl),
    apiPrefix: DEFAULT_API_PREFIX,
  };
}

function normalizeApiBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ServerConnectionError("config_invalid", "api_base is not a valid url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ServerConnectionError("config_invalid", "api_base must use http/https");
  }

  const withoutTrailingSlash = parsed.toString().replace(/\/+$/, "");
  return withoutTrailingSlash;
}

function normalizeWsURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ServerConnectionError("config_invalid", "ws_url is not a valid url");
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new ServerConnectionError("config_invalid", "ws_url must use ws/wss");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeApiPrefix(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    throw new ServerConnectionError("config_invalid", "api_prefix must start with /");
  }
  if (normalized.length < 2) {
    throw new ServerConnectionError("config_invalid", "api_prefix is too short");
  }
  return normalized.replace(/\/+$/, "");
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
