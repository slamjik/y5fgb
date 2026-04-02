package service

import "fmt"

type ErrorCode string

const (
	ErrorCodeInvalidCredentials         ErrorCode = "invalid_credentials"
	ErrorCodeTwoFARequired              ErrorCode = "two_fa_required"
	ErrorCodeDeviceNotApproved          ErrorCode = "device_not_approved"
	ErrorCodeForbiddenLastTrustedRevoke ErrorCode = "forbidden_last_trusted_revoke"
	ErrorCodeInvalidRecoveryToken       ErrorCode = "invalid_recovery_token"
	ErrorCodeAccountAlreadyExists       ErrorCode = "account_already_exists"
	ErrorCodeFingerprintMismatch        ErrorCode = "fingerprint_mismatch"
	ErrorCodeTransportUnavailable       ErrorCode = "transport_unavailable"
	ErrorCodeEndpointUnreachable        ErrorCode = "endpoint_unreachable"
	ErrorCodeSyncConflict               ErrorCode = "sync_conflict"
	ErrorCodeConversationNotFound       ErrorCode = "conversation_not_found"
	ErrorCodeMembershipDenied           ErrorCode = "membership_denied"
	ErrorCodeAttachmentUploadFailed     ErrorCode = "attachment_upload_failed"
	ErrorCodeAttachmentDownloadFailed   ErrorCode = "attachment_download_failed"
	ErrorCodeMessageEncryptFailed       ErrorCode = "message_encrypt_failed"
	ErrorCodeMessageDecryptFailed       ErrorCode = "message_decrypt_failed"
	ErrorCodeLocalStorageUnavailable    ErrorCode = "local_storage_unavailable"
	ErrorCodeMessageExpired             ErrorCode = "message_expired"
	ErrorCodeRetryableTransport         ErrorCode = "retryable_transport_error"
	ErrorCodePluginManifestInvalid      ErrorCode = "plugin_manifest_invalid"
	ErrorCodePluginPermissionDenied     ErrorCode = "plugin_permission_denied"
	ErrorCodePluginRuntimeInitFailed    ErrorCode = "plugin_runtime_init_failed"
	ErrorCodePluginBridgeViolation      ErrorCode = "plugin_bridge_violation"
	ErrorCodePluginLoadFailed           ErrorCode = "plugin_load_failed"
	ErrorCodePluginDisabled             ErrorCode = "plugin_disabled"
	ErrorCodePluginStorageUnavailable   ErrorCode = "plugin_storage_unavailable"
	ErrorCodeUnauthorized               ErrorCode = "unauthorized"
	ErrorCodeForbidden                  ErrorCode = "forbidden"
	ErrorCodeValidation                 ErrorCode = "validation_error"
	ErrorCodeNotFound                   ErrorCode = "not_found"
	ErrorCodeInternal                   ErrorCode = "internal_error"
)

type AppError struct {
	Code    ErrorCode
	Message string
	Details map[string]any
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func NewError(code ErrorCode, message string) *AppError {
	return &AppError{Code: code, Message: message}
}

func NewErrorWithDetails(code ErrorCode, message string, details map[string]any) *AppError {
	return &AppError{Code: code, Message: message, Details: details}
}
