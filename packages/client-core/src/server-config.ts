const DEFAULT_API_PREFIX = "/api/v1";
const DEFAULT_WS_PATH = "/ws";

export interface ServerPolicyHints {
  authModesSupported: Array<"device" | "browser_session">;
  browserSessionDefaultPersistence: "ephemeral" | "remembered";
  browserSessionAllowRemembered: boolean;
}

export interface TransportProfileHints {
  reconnectBackoffMinMs: number;
  reconnectBackoffMaxMs: number;
  longPollTimeoutSec: number;
  longPollEnabled: boolean;
}

export interface ServerBootstrapConfig {
  apiBaseUrl: string;
  wsUrl: string;
  apiPrefix: string;
  policyHints?: ServerPolicyHints;
  transportHints?: TransportProfileHints;
}

export class ServerConfigError extends Error {
  readonly code: "invalid_input" | "connection_failed" | "config_invalid";

  constructor(code: "invalid_input" | "connection_failed" | "config_invalid", message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeServerInput(input: string): { origin: string; inputHost: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ServerConfigError("invalid_input", "server input is empty");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${shouldDefaultToHTTP(trimmed) ? "http" : "https"}://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ServerConfigError("invalid_input", "server input is not a valid url");
  }

  if (!parsed.hostname) {
    throw new ServerConfigError("invalid_input", "server hostname is required");
  }

  return {
    origin: parsed.origin,
    inputHost: parsed.host,
  };
}

export function buildServerConfigEndpoint(origin: string): string {
  return new URL(`${DEFAULT_API_PREFIX}/config`, origin).toString();
}

export function buildFallbackConfig(apiBaseOrigin: string): ServerBootstrapConfig {
  const apiBase = normalizeApiBase(apiBaseOrigin);
  const parsed = new URL(apiBase);
  const wsScheme = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsScheme}//${parsed.host}${DEFAULT_WS_PATH}`;

  return {
    apiBaseUrl: apiBase,
    wsUrl: normalizeWsURL(wsUrl),
    apiPrefix: DEFAULT_API_PREFIX,
    policyHints: {
      authModesSupported: ["device", "browser_session"],
      browserSessionDefaultPersistence: "ephemeral",
      browserSessionAllowRemembered: true,
    },
    transportHints: {
      reconnectBackoffMinMs: 500,
      reconnectBackoffMaxMs: 10000,
      longPollTimeoutSec: 25,
      longPollEnabled: true,
    },
  };
}

export function parseServerConfigPayload(payload: unknown): ServerBootstrapConfig {
  if (!payload || typeof payload !== "object") {
    throw new ServerConfigError("config_invalid", "server config response has invalid shape");
  }

  const source = payload as Record<string, unknown>;
  if (
    typeof source.api_base !== "string" ||
    typeof source.ws_url !== "string" ||
    typeof source.api_prefix !== "string"
  ) {
    throw new ServerConfigError("config_invalid", "server config response has missing required fields");
  }

  return {
    apiBaseUrl: normalizeApiBase(source.api_base),
    wsUrl: normalizeWsURL(source.ws_url),
    apiPrefix: normalizeApiPrefix(source.api_prefix),
    policyHints: parsePolicyHints(source.policy_hints),
    transportHints: parseTransportHints(source.transport_profile_hints),
  };
}

export function normalizeApiBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ServerConfigError("config_invalid", "api_base is not a valid url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ServerConfigError("config_invalid", "api_base must use http/https");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeWsURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ServerConfigError("config_invalid", "ws_url is not a valid url");
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new ServerConfigError("config_invalid", "ws_url must use ws/wss");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeApiPrefix(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    throw new ServerConfigError("config_invalid", "api_prefix must start with /");
  }
  if (normalized.length < 2) {
    throw new ServerConfigError("config_invalid", "api_prefix is too short");
  }
  return normalized.replace(/\/+$/, "");
}

function shouldDefaultToHTTP(value: string): boolean {
  const candidate = value.trim().replace(/\/.*$/, "");
  if (candidate === "localhost") {
    return true;
  }
  return /^([0-9]{1,3}\.){3}[0-9]{1,3}(:[0-9]{1,5})?$/.test(candidate);
}

function parsePolicyHints(value: unknown): ServerPolicyHints | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const authModesSupportedRaw = source.auth_modes_supported;
  const browserSessionDefaultPersistence = source.browser_session_default_persistence;
  const browserSessionAllowRemembered = source.browser_session_allow_remembered;

  if (
    !Array.isArray(authModesSupportedRaw) ||
    typeof browserSessionDefaultPersistence !== "string" ||
    typeof browserSessionAllowRemembered !== "boolean"
  ) {
    return undefined;
  }

  const authModesSupported = authModesSupportedRaw.filter(
    (item): item is "device" | "browser_session" => item === "device" || item === "browser_session",
  );
  if (authModesSupported.length === 0) {
    return undefined;
  }

  if (browserSessionDefaultPersistence !== "ephemeral" && browserSessionDefaultPersistence !== "remembered") {
    return undefined;
  }

  return {
    authModesSupported,
    browserSessionDefaultPersistence,
    browserSessionAllowRemembered,
  };
}

function parseTransportHints(value: unknown): TransportProfileHints | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const reconnectBackoffMinMs = toPositiveInt(source.reconnect_backoff_min_ms);
  const reconnectBackoffMaxMs = toPositiveInt(source.reconnect_backoff_max_ms);
  const longPollTimeoutSec = toPositiveInt(source.long_poll_timeout_sec);
  const longPollEnabled = source.long_poll_enabled;

  if (
    reconnectBackoffMinMs === null ||
    reconnectBackoffMaxMs === null ||
    longPollTimeoutSec === null ||
    typeof longPollEnabled !== "boolean"
  ) {
    return undefined;
  }

  return {
    reconnectBackoffMinMs,
    reconnectBackoffMaxMs,
    longPollTimeoutSec,
    longPollEnabled,
  };
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}
