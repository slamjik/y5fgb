export type Environment = "development" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  appName: string;
  environment: Environment;
  apiBaseUrl: string;
  apiPrefix: string;
  wsUrl: string;
  wsQueryTokenFallback: boolean;
  transportEndpointOverrides: string[];
  logLevel: LogLevel;
}

const acceptedLogLevels: LogLevel[] = ["debug", "info", "warn", "error"];

function readEnv(key: string, fallback?: string): string {
  const value = import.meta.env[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof fallback === "string") {
    return fallback;
  }

  throw new Error(`Missing required environment variable: ${key}`);
}

function toEnvironment(mode: string): Environment {
  return mode === "production" ? "production" : "development";
}

function toBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function toLogLevel(value: string): LogLevel {
  if (acceptedLogLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }

  return "info";
}

export const appConfig: AppConfig = {
  appName: readEnv("VITE_APP_NAME", "Secure Messenger"),
  environment: toEnvironment(import.meta.env.MODE),
  apiBaseUrl: readEnv("VITE_API_BASE_URL"),
  apiPrefix: readEnv("VITE_API_PREFIX", "/api/v1"),
  wsUrl: readEnv("VITE_WS_URL", deriveWsFallback(readEnv("VITE_API_BASE_URL"))),
  wsQueryTokenFallback: toBool(
    readEnv("VITE_WS_QUERY_TOKEN_FALLBACK", import.meta.env.MODE === "development" ? "true" : "false"),
    import.meta.env.MODE === "development",
  ),
  transportEndpointOverrides: splitCSV(readEnv("VITE_TRANSPORT_ENDPOINT_OVERRIDES", "")),
  logLevel: toLogLevel(readEnv("VITE_LOG_LEVEL", "info")),
};

function deriveWsFallback(apiBaseUrl: string): string {
  if (apiBaseUrl.startsWith("https://")) {
    return apiBaseUrl.replace("https://", "wss://") + "/ws";
  }
  if (apiBaseUrl.startsWith("http://")) {
    return apiBaseUrl.replace("http://", "ws://") + "/ws";
  }
  return "ws://localhost:8080/ws";
}

function splitCSV(value: string): string[] {
  if (!value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
