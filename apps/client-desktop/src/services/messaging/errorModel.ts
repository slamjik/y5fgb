import { ApiClientError, extractApiErrorCode, extractApiErrorMessage } from "@/services/apiClient";

export type MessagingFailureClass = "retryable" | "non_retryable";

export interface ClassifiedMessagingError {
  code: string;
  message: string;
  class: MessagingFailureClass;
}

const NON_RETRYABLE_CODES = new Set([
  "conversation_not_found",
  "membership_denied",
  "validation_error",
  "message_encrypt_failed",
  "message_decrypt_failed",
  "message_expired",
  "forbidden",
  "unauthorized",
]);

const RETRYABLE_CODES = new Set([
  "retryable_transport_error",
  "transport_unavailable",
  "endpoint_unreachable",
  "sync_conflict",
  "attachment_upload_failed",
  "attachment_download_failed",
  "internal_error",
  "local_storage_unavailable",
]);

export function classifyMessagingError(error: unknown): ClassifiedMessagingError {
  const message = extractApiErrorMessage(error);
  const code = extractApiErrorCode(error);

  if (RETRYABLE_CODES.has(code)) {
    return { code, message, class: "retryable" };
  }
  if (NON_RETRYABLE_CODES.has(code)) {
    return { code, message, class: "non_retryable" };
  }

  if (error instanceof ApiClientError) {
    if (error.status >= 500) {
      return { code, message, class: "retryable" };
    }
    return { code, message, class: "non_retryable" };
  }

  return { code: "unknown", message, class: "retryable" };
}
