export interface HttpRequestOptions {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  accessToken?: string;
  timeoutMs?: number;
}

export class HttpRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(message: string, status: number, code?: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const defaultTimeoutMs = 10000;

export async function requestJSON<T>(options: HttpRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: buildHeaders(options.accessToken, options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : undefined;

    if (!response.ok) {
      const code = extractErrorCode(payload);
      const message = extractErrorMessage(payload) ?? `request failed with status ${response.status}`;
      throw new HttpRequestError(message, response.status, code, payload);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpRequestError("request timed out", 0, "endpoint_unreachable");
    }
    throw new HttpRequestError(error instanceof Error ? error.message : "request failed", 0, "endpoint_unreachable");
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildHeaders(accessToken: string | undefined, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function extractErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : undefined;
}
