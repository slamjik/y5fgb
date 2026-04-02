import { appConfig, type LogLevel } from "@/lib/config";

type LogContext = Record<string, unknown>;

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class ClientLogger {
  constructor(private readonly minLevel: LogLevel) {}

  debug(message: string, context?: LogContext) {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext) {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext) {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    if (priority[level] < priority[this.minLevel]) {
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      context: sanitizeContext(context ?? {}),
    };

    if (level === "error") {
      console.error(entry);
      return;
    }

    if (level === "warn") {
      console.warn(entry);
      return;
    }

    console.log(entry);
  }
}

export const logger = new ClientLogger(appConfig.logLevel);

const REDACTED = "[redacted]";
const SENSITIVE_KEYS = ["password", "secret", "token", "private", "key", "ciphertext", "plaintext"];

function sanitizeContext(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContext(item));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = sanitizeContext(item);
      }
    }
    return output;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}
