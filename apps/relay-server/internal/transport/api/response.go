package api

import (
	"encoding/json"
	"net/http"

	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
)

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteServiceError(w http.ResponseWriter, r *http.Request, err error, fallbackStatus int) {
	appErr, ok := err.(*service.AppError)
	if !ok {
		appErr = service.NewError(service.ErrorCodeInternal, "internal server error")
	}

	status := statusFromCode(appErr.Code)
	if fallbackStatus == http.StatusMethodNotAllowed {
		status = fallbackStatus
	}
	if status == 0 {
		status = fallbackStatus
	}

	payload := map[string]any{
		"error": map[string]any{
			"code":       appErr.Code,
			"message":    appErr.Message,
			"request_id": middleware.RequestIDFromContext(r.Context()),
		},
	}
	if appErr.Details != nil {
		payload["error"].(map[string]any)["details"] = appErr.Details
	}

	WriteJSON(w, status, payload)
}

func statusFromCode(code service.ErrorCode) int {
	switch code {
	case service.ErrorCodeInvalidCredentials, service.ErrorCodeUnauthorized, service.ErrorCodeInvalidRecoveryToken:
		return http.StatusUnauthorized
	case service.ErrorCodeForbidden, service.ErrorCodeForbiddenLastTrustedRevoke:
		return http.StatusForbidden
	case service.ErrorCodeTwoFARequired:
		return http.StatusUnauthorized
	case service.ErrorCodeAccountAlreadyExists:
		return http.StatusConflict
	case service.ErrorCodeValidation, service.ErrorCodeFingerprintMismatch:
		return http.StatusBadRequest
	case service.ErrorCodeConversationNotFound:
		return http.StatusNotFound
	case service.ErrorCodeMembershipDenied:
		return http.StatusForbidden
	case service.ErrorCodeAttachmentUploadFailed, service.ErrorCodeAttachmentDownloadFailed:
		return http.StatusBadRequest
	case service.ErrorCodeTransportUnavailable:
		return http.StatusServiceUnavailable
	case service.ErrorCodeEndpointUnreachable:
		return http.StatusBadGateway
	case service.ErrorCodeSyncConflict:
		return http.StatusConflict
	case service.ErrorCodeMessageEncryptFailed, service.ErrorCodeMessageDecryptFailed, service.ErrorCodeLocalStorageUnavailable:
		return http.StatusBadRequest
	case service.ErrorCodeMessageExpired:
		return http.StatusGone
	case service.ErrorCodeRetryableTransport:
		return http.StatusServiceUnavailable
	case service.ErrorCodePluginManifestInvalid, service.ErrorCodePluginLoadFailed:
		return http.StatusBadRequest
	case service.ErrorCodePluginPermissionDenied, service.ErrorCodePluginBridgeViolation, service.ErrorCodePluginDisabled:
		return http.StatusForbidden
	case service.ErrorCodePluginRuntimeInitFailed, service.ErrorCodePluginStorageUnavailable:
		return http.StatusInternalServerError
	case service.ErrorCodeNotFound:
		return http.StatusNotFound
	case service.ErrorCodeDeviceNotApproved:
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}
