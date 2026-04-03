import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  buildFallbackConfig,
  buildServerConfigEndpoint,
  normalizeApiBase,
  normalizeApiPrefix,
  normalizeServerInput,
  normalizeWsURL,
  parseServerConfigPayload,
  type ServerBootstrapConfig,
  ServerConfigError,
} from "@project/client-core";

import { requestJSON, HttpRequestError } from "../lib/http";

export type BootstrapStatus = "booting" | "needs_server" | "ready" | "error";

export interface ResolvedServerConfig extends ServerBootstrapConfig {
  source: "stored" | "env" | "manual";
  inputHost?: string;
}

interface StoredServerConfig {
  apiBaseUrl: string;
  wsUrl: string;
  apiPrefix: string;
  inputHost: string;
  savedAt: string;
}

interface BootstrapContextValue {
  status: BootstrapStatus;
  serverConfig: ResolvedServerConfig | null;
  errorMessage: string | null;
  connectToServer: (input: string) => Promise<boolean>;
  resetServerConfig: () => void;
}

const serverConfigStorageKey = "secure-messenger-web-server-config-v1";

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function BootstrapProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BootstrapStatus>("booting");
  const [serverConfig, setServerConfig] = useState<ResolvedServerConfig | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredServerConfig();
    if (stored) {
      setServerConfig({ ...stored, source: "stored" });
      setStatus("ready");
      return;
    }

    const envConfig = loadEnvServerConfig();
    if (envConfig) {
      setServerConfig(envConfig);
      setStatus("ready");
      return;
    }

    let cancelled = false;
    void (async () => {
      const autoConfig = await tryAutoDiscoverFromCurrentOrigin();
      if (cancelled) {
        return;
      }
      if (autoConfig) {
        setServerConfig(autoConfig);
        setStatus("ready");
        return;
      }
      setStatus("needs_server");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connectToServer = useCallback(async (input: string): Promise<boolean> => {
    setErrorMessage(null);

    try {
      const normalized = normalizeServerInput(input);
      const endpoint = buildServerConfigEndpoint(normalized.origin);

      let discovered: ServerBootstrapConfig;
      try {
        const payload = await requestJSON<unknown>({ method: "GET", url: endpoint, timeoutMs: 7000 });
        discovered = parseServerConfigPayload(payload);
      } catch (error) {
        if (error instanceof HttpRequestError && error.status === 404) {
          discovered = buildFallbackConfig(normalized.origin);
        } else {
          throw error;
        }
      }

      const next: ResolvedServerConfig = {
        ...discovered,
        source: "manual",
        inputHost: normalized.inputHost,
      };
      persistServerConfig(next);
      setServerConfig(next);
      setStatus("ready");
      return true;
    } catch (error) {
      const message = mapBootstrapError(error);
      setErrorMessage(message);
      setStatus("error");
      return false;
    }
  }, []);

  const resetServerConfig = useCallback(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(serverConfigStorageKey);
    }
    setServerConfig(null);
    setErrorMessage(null);
    setStatus("needs_server");
  }, []);

  const value = useMemo<BootstrapContextValue>(
    () => ({
      status,
      serverConfig,
      errorMessage,
      connectToServer,
      resetServerConfig,
    }),
    [status, serverConfig, errorMessage, connectToServer, resetServerConfig],
  );

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap(): BootstrapContextValue {
  const context = useContext(BootstrapContext);
  if (!context) {
    throw new Error("useBootstrap must be used inside BootstrapProvider");
  }
  return context;
}

function mapBootstrapError(error: unknown): string {
  if (error instanceof ServerConfigError) {
    if (error.code === "invalid_input") {
      return "Введите корректный адрес сервера.";
    }
    if (error.code === "connection_failed") {
      return "Не удалось подключиться к серверу. Проверьте адрес и сеть.";
    }
    return "Сервер вернул некорректную конфигурацию.";
  }
  if (error instanceof HttpRequestError) {
    if (error.code === "endpoint_unreachable") {
      return "Не удалось подключиться к серверу. Проверьте адрес и сеть.";
    }
    return "Не удалось получить конфигурацию сервера.";
  }
  if (error instanceof Error) {
    return "Не удалось получить конфигурацию сервера.";
  }
  return "Не удалось подключиться к серверу.";
}

function loadEnvServerConfig(): ResolvedServerConfig | null {
  const apiBaseRaw = readEnv("VITE_API_BASE_URL");
  const wsUrlRaw = readEnv("VITE_WS_URL");
  const apiPrefixRaw = readEnv("VITE_API_PREFIX");

  if (!apiBaseRaw || !wsUrlRaw || !apiPrefixRaw) {
    return null;
  }

  try {
    return {
      apiBaseUrl: normalizeApiBase(apiBaseRaw),
      wsUrl: normalizeWsURL(wsUrlRaw),
      apiPrefix: normalizeApiPrefix(apiPrefixRaw),
      source: "env",
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
  } catch {
    return null;
  }
}

function loadStoredServerConfig(): ResolvedServerConfig | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const raw = localStorage.getItem(serverConfigStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredServerConfig>;
    if (
      !parsed ||
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
      source: "stored",
      inputHost: parsed.inputHost,
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
  } catch {
    return null;
  }
}

function persistServerConfig(config: ResolvedServerConfig) {
  if (typeof localStorage === "undefined") {
    return;
  }

  const payload: StoredServerConfig = {
    apiBaseUrl: config.apiBaseUrl,
    wsUrl: config.wsUrl,
    apiPrefix: config.apiPrefix,
    inputHost: config.inputHost ?? hostFromApiBase(config.apiBaseUrl),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(serverConfigStorageKey, JSON.stringify(payload));
}

function hostFromApiBase(apiBaseUrl: string): string {
  try {
    return new URL(apiBaseUrl).host;
  } catch {
    return apiBaseUrl;
  }
}

function readEnv(name: string): string {
  const value = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return typeof value === "string" ? value : "";
}

async function tryAutoDiscoverFromCurrentOrigin(): Promise<ResolvedServerConfig | null> {
  if (typeof window === "undefined" || !window.location?.origin) {
    return null;
  }

  const origin = window.location.origin;
  const endpoint = buildServerConfigEndpoint(origin);

  try {
    const payload = await requestJSON<unknown>({
      method: "GET",
      url: endpoint,
      timeoutMs: 4000,
    });
    const discovered = parseServerConfigPayload(payload);
    return {
      ...discovered,
      source: "manual",
      inputHost: window.location.host,
    };
  } catch {
    return null;
  }
}
