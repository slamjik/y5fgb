import type { ErrorPayload } from "@project/protocol";

import { getActiveServerConfig } from "@/services/serverConnection";
import i18n from "@/services/i18n";

export class ApiClientError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    const parsed = payload as ErrorPayload;
    const message = parsed?.error?.message ?? "API request failed";
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function buildUrl(path: string) {
  const server = getActiveServerConfig();
  return `${server.apiBaseUrl}${server.apiPrefix}${path}`;
}

export async function apiRequest<TResponse>(options: {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
}): Promise<TResponse> {
  const response = await fetch(buildUrl(options.path), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  let payload: unknown = null;

  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  if (!response.ok) {
    throw new ApiClientError(response.status, payload);
  }

  return payload as TResponse;
}

export async function absoluteApiRequest<TResponse>(options: {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
}): Promise<TResponse> {
  const response = await fetch(options.url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  let payload: unknown = null;

  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  if (!response.ok) {
    throw new ApiClientError(response.status, payload);
  }

  return payload as TResponse;
}

export function extractApiErrorCode(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "unknown";
  }

  const payload = error.payload as ErrorPayload;
  return payload?.error?.code ?? "unknown";
}

export function extractApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    const payload = error.payload as ErrorPayload;
    const code = payload?.error?.code;
    if (code) {
      const localized = i18n.t(`errors.codes.${code}`);
      const hint = buildActionHint(code);
      if (localized && localized !== `errors.codes.${code}`) {
        return hint ? `${localized} ${hint}` : localized;
      }
      if (friendlyErrorMessages[code]) {
        return hint ? `${friendlyErrorMessages[code]} ${hint}` : friendlyErrorMessages[code];
      }
    }
    return payload?.error?.message ?? i18n.t("errors.generic");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return i18n.t("errors.generic");
}

const friendlyErrorMessages: Record<string, string> = {
  transport_unavailable: "Transport is temporarily unavailable. Retrying can help.",
  endpoint_unreachable: "Current endpoint is unreachable. Client will rotate to fallback endpoints.",
  retryable_transport_error: "Temporary transport error. Message stayed in queue for retry.",
  local_storage_unavailable: "Secure local storage is unavailable. Messaging is paused until storage is restored.",
  message_decrypt_failed: "Message could not be decrypted on this device.",
  membership_denied: "You do not have access to this conversation.",
  conversation_not_found: "Conversation was not found.",
  attachment_upload_failed: "Attachment upload failed. You can retry.",
  attachment_download_failed: "Attachment download failed. You can retry.",
  message_expired: "Message expired according to disappearing message policy.",
  plugin_manifest_invalid: "Plugin manifest is invalid.",
  plugin_permission_denied: "Plugin permission denied by policy.",
  plugin_runtime_init_failed: "Plugin runtime failed to initialize.",
  plugin_bridge_violation: "Plugin bridge request violated security policy.",
  plugin_load_failed: "Plugin could not be loaded.",
  plugin_disabled: "Plugin is currently disabled.",
  plugin_storage_unavailable: "Plugin local storage is unavailable.",
};

const retryHintCodes = new Set([
  "transport_unavailable",
  "endpoint_unreachable",
  "retryable_transport_error",
  "attachment_upload_failed",
  "attachment_download_failed",
]);

const reconnectHintCodes = new Set(["local_storage_unavailable"]);

function buildActionHint(code: string): string {
  if (retryHintCodes.has(code)) {
    return i18n.t("errors.actionHintRetry");
  }
  if (reconnectHintCodes.has(code)) {
    return i18n.t("errors.actionHintReconnect");
  }
  return "";
}
