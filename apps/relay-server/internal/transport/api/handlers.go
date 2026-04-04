package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/devices"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/messaging"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/recovery"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
)

type Handler struct {
	logger                *slog.Logger
	authService           *auth.Service
	deviceService         *devices.Service
	recoveryService       *recovery.Service
	eventService          *securityevents.Service
	messagingService      *messaging.Service
	cfg                   config.Config
	authRateLimiter       *middleware.IPRateLimiter
	recoveryRateLimiter   *middleware.IPRateLimiter
	messageRateLimiter    *middleware.IPRateLimiter
	attachmentRateLimiter *middleware.IPRateLimiter
}

const (
	maxAuthBodyBytes       int64 = 64 * 1024
	maxRecoveryBodyBytes   int64 = 64 * 1024
	maxMessageBodyBytes    int64 = 3 * 1024 * 1024
	maxAttachmentBodyBytes int64 = 32 * 1024 * 1024
)

func NewHandler(
	logger *slog.Logger,
	authService *auth.Service,
	deviceService *devices.Service,
	recoveryService *recovery.Service,
	eventService *securityevents.Service,
	messagingService *messaging.Service,
	cfg config.Config,
) *Handler {
	return &Handler{
		logger:                logger,
		authService:           authService,
		deviceService:         deviceService,
		recoveryService:       recoveryService,
		eventService:          eventService,
		messagingService:      messagingService,
		cfg:                   cfg,
		authRateLimiter:       middleware.NewIPRateLimiter(30, time.Minute, nil),
		recoveryRateLimiter:   middleware.NewIPRateLimiter(10, time.Minute, nil),
		messageRateLimiter:    middleware.NewIPRateLimiter(180, time.Minute, nil),
		attachmentRateLimiter: middleware.NewIPRateLimiter(60, time.Minute, nil),
	}
}

func RegisterRoutes(mux *http.ServeMux, prefix string, handler *Handler, authService *auth.Service) {
	base := strings.TrimRight(prefix, "/")

	mux.HandleFunc(base+"/auth/register", handler.handleRegister)
	mux.HandleFunc(base+"/auth/web/register", handler.handleWebRegister)
	mux.HandleFunc(base+"/auth/login", handler.handleLogin)
	mux.HandleFunc(base+"/auth/web/login", handler.handleWebLogin)
	mux.HandleFunc(base+"/auth/2fa/login/verify", handler.handleTwoFALoginVerify)
	mux.HandleFunc(base+"/auth/web/2fa/verify", handler.handleWebTwoFALoginVerify)
	mux.HandleFunc(base+"/auth/refresh", handler.handleRefresh)
	mux.HandleFunc(base+"/auth/web/refresh", handler.handleWebRefresh)
	mux.HandleFunc(base+"/auth/logout", handler.handleLogout)
	mux.Handle(base+"/auth/web/logout", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleWebLogout)))
	mux.Handle(base+"/auth/logout-all", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleLogoutAll)))
	mux.Handle(base+"/auth/web/logout-all", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleWebLogoutAll)))
	mux.Handle(base+"/auth/session", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSession)))
	mux.Handle(base+"/auth/web/session", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleWebSession)))

	mux.Handle(base+"/auth/2fa/setup/start", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleTwoFASetupStart)))
	mux.Handle(base+"/auth/2fa/setup/confirm", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleTwoFASetupConfirm)))
	mux.Handle(base+"/auth/2fa/disable", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleTwoFADisable)))

	mux.Handle(base+"/devices", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleListDevices)))
	mux.Handle(base+"/devices/approve", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleDeviceApprove)))
	mux.Handle(base+"/devices/reject", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleDeviceReject)))
	mux.Handle(base+"/devices/revoke", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleDeviceRevoke)))
	mux.Handle(base+"/devices/keys/rotate", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleDeviceKeyRotate)))
	mux.HandleFunc(base+"/devices/approvals/status", handler.handleDeviceApprovalStatus)

	mux.HandleFunc(base+"/recovery/start", handler.handleRecoveryStart)
	mux.HandleFunc(base+"/recovery/complete", handler.handleRecoveryComplete)

	mux.Handle(base+"/security-events", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSecurityEvents)))

	mux.Handle(base+"/conversations/direct", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleCreateDirectConversation)))
	mux.Handle(base+"/conversations/group", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleCreateGroupConversation)))
	mux.Handle(base+"/conversations", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleListConversations)))
	mux.Handle(base+"/conversations/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleConversationSubroutes)))
	mux.Handle(base+"/messages/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleMessageSubroutes)))
	mux.Handle(base+"/attachments/upload", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleAttachmentUpload)))
	mux.Handle(base+"/attachments/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleAttachmentSubroutes)))
	mux.Handle(base+"/sync/bootstrap", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSyncBootstrap)))
	mux.Handle(base+"/sync/poll", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSyncPoll)))
	mux.Handle(base+"/transport/endpoints", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleTransportEndpoints)))
	mux.HandleFunc(base+"/config", handler.handlePublicConfig)
}

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req registerRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, recoveryCodes, err := h.authService.Register(r.Context(), auth.RegisterInput{
		Email:                      req.Email,
		Password:                   req.Password,
		AccountIdentityMaterial:    req.AccountIdentityMaterial,
		AccountIdentityFingerprint: req.AccountIdentityFingerprint,
		Device: auth.DeviceInput{
			DeviceID:             req.Device.DeviceID,
			Name:                 req.Device.Name,
			Platform:             req.Device.Platform,
			PublicDeviceMaterial: req.Device.PublicDeviceMaterial,
			Fingerprint:          req.Device.Fingerprint,
		},
		UserAgent: r.UserAgent(),
		IPAddress: r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, buildEnvelopeResponse(result, recoveryCodes))
}

func (h *Handler) handleWebRegister(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req webRegisterRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.RegisterWeb(r.Context(), auth.WebRegisterInput{
		Email:              req.Email,
		Password:           req.Password,
		SessionPersistence: req.SessionPersistence,
		UserAgent:          r.UserAgent(),
		IPAddress:          r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, buildEnvelopeResponse(result, nil))
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req loginRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.Login(r.Context(), auth.LoginInput{
		Email:    req.Email,
		Password: req.Password,
		Device: auth.DeviceInput{
			DeviceID:             req.Device.DeviceID,
			Name:                 req.Device.Name,
			Platform:             req.Device.Platform,
			PublicDeviceMaterial: req.Device.PublicDeviceMaterial,
			Fingerprint:          req.Device.Fingerprint,
		},
		UserAgent: r.UserAgent(),
		IPAddress: r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	if result.PendingApprovalID != "" {
		WriteJSON(w, http.StatusAccepted, map[string]any{
			"approvalRequestId": result.PendingApprovalID,
			"approvalPollToken": result.ApprovalPollToken,
			"status":            result.ApprovalStatus,
		})
		return
	}

	if result.TwoFAChallengeID != "" {
		WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"error": map[string]any{
				"code":       service.ErrorCodeTwoFARequired,
				"message":    "two-factor verification is required",
				"request_id": middleware.RequestIDFromContext(r.Context()),
			},
			"challengeId": result.TwoFAChallengeID,
			"loginToken":  result.TwoFALoginToken,
			"expiresAt":   result.TwoFAChallengeExpires.UTC().Format(time.RFC3339),
		})
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result.Session, nil))
}

func (h *Handler) handleWebLogin(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req webLoginRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.LoginWeb(r.Context(), auth.WebLoginInput{
		Email:              req.Email,
		Password:           req.Password,
		SessionPersistence: req.SessionPersistence,
		UserAgent:          r.UserAgent(),
		IPAddress:          r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	if result.TwoFAChallengeID != "" {
		WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"error": map[string]any{
				"code":       service.ErrorCodeTwoFARequired,
				"message":    "two-factor verification is required",
				"request_id": middleware.RequestIDFromContext(r.Context()),
			},
			"challengeId": result.TwoFAChallengeID,
			"loginToken":  result.TwoFALoginToken,
			"expiresAt":   result.TwoFAChallengeExpires.UTC().Format(time.RFC3339),
		})
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result.Session, nil))
}

func (h *Handler) handleTwoFALoginVerify(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req twoFALoginVerifyRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.VerifyTwoFALogin(r.Context(), auth.VerifyTwoFALoginInput{
		ChallengeID: req.ChallengeID,
		LoginToken:  req.LoginToken,
		Code:        req.Code,
		UserAgent:   r.UserAgent(),
		IPAddress:   r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result, nil))
}

func (h *Handler) handleWebTwoFALoginVerify(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.authRateLimiter) {
		return
	}
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req webTwoFALoginVerifyRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.VerifyWebTwoFALogin(r.Context(), auth.VerifyWebTwoFALoginInput{
		ChallengeID:        req.ChallengeID,
		LoginToken:         req.LoginToken,
		Code:               req.Code,
		SessionPersistence: req.SessionPersistence,
		UserAgent:          r.UserAgent(),
		IPAddress:          r.RemoteAddr,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result, nil))
}

func (h *Handler) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req refreshRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result, nil))
}

func (h *Handler) handleWebRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req webRefreshRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.authService.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, buildEnvelopeResponse(result, nil))
}

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req logoutRequest
	if r.ContentLength > 0 {
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
	}

	var principal *auth.AuthPrincipal
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		resolved, err := h.authService.AuthenticateAccessToken(r.Context(), strings.TrimPrefix(authHeader, "Bearer "))
		if err == nil {
			principal = resolved
		}
	}

	if err := h.authService.Logout(r.Context(), principal, req.RefreshToken); err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) handleWebLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	var req webLogoutRequest
	if r.ContentLength > 0 {
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	if err := h.authService.Logout(r.Context(), &principal, req.RefreshToken); err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	revoked, err := h.authService.LogoutAll(r.Context(), principal)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusInternalServerError)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"revokedSessions": revoked})
}

func (h *Handler) handleWebLogoutAll(w http.ResponseWriter, r *http.Request) {
	h.handleLogoutAll(w, r)
}

func (h *Handler) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	envelope, err := h.authService.GetSessionEnvelope(r.Context(), principal)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"accountId":        envelope.Account.ID,
		"email":            envelope.Account.Email,
		"twoFactorEnabled": envelope.Account.TwoFAEnabled,
		"identity":         mapIdentity(envelope.Identity),
		"device":           mapDevice(envelope.Device),
		"session":          mapSession(envelope.Session, envelope.Device),
	})
}

func (h *Handler) handleWebSession(w http.ResponseWriter, r *http.Request) {
	h.handleSession(w, r)
}

func (h *Handler) handleTwoFASetupStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	result, err := h.authService.StartTwoFASetup(r.Context(), principal)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"secret": result.Secret, "provisioningUri": result.ProvisioningURI})
}

func (h *Handler) handleTwoFASetupConfirm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req twoFAConfirmRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	recoveryCodes, err := h.authService.ConfirmTwoFASetup(r.Context(), principal, req.Code)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"enabled": true, "recoveryCodes": recoveryCodes})
}

func (h *Handler) handleTwoFADisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req twoFADisableRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.authService.DisableTwoFA(r.Context(), principal, req.Code); err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"disabled": true})
}

func (h *Handler) handleListDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	result, err := h.deviceService.List(r.Context(), principal)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusInternalServerError)
		return
	}

	deviceItems := make([]deviceDTO, 0, len(result.Devices))
	for _, device := range result.Devices {
		deviceItems = append(deviceItems, mapDevice(device))
	}
	approvalItems := make([]approvalDTO, 0, len(result.Approvals))
	for _, approval := range result.Approvals {
		approvalItems = append(approvalItems, mapApproval(approval))
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"currentDeviceId": result.CurrentDeviceID,
		"devices":         deviceItems,
		"approvals":       approvalItems,
	})
}

func (h *Handler) handleDeviceApprove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req deviceApproveRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.deviceService.Approve(r.Context(), principal, req.ApprovalRequestID, req.TwoFactorCode); err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"approved": true})
}

func (h *Handler) handleDeviceReject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req deviceRejectRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.deviceService.Reject(r.Context(), principal, req.ApprovalRequestID, req.TwoFactorCode); err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"rejected": true})
}

func (h *Handler) handleDeviceRevoke(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req deviceRevokeRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.deviceService.Revoke(r.Context(), principal, req.DeviceID, req.TwoFactorCode); err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"revoked": true})
}

func (h *Handler) handleDeviceKeyRotate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req deviceRotateKeyRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	rotated, err := h.deviceService.RotateCurrentDeviceKey(r.Context(), principal, req.PublicDeviceMaterial, req.Fingerprint, req.TwoFactorCode)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"device": mapDevice(rotated)})
}

func (h *Handler) handleDeviceApprovalStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	approvalRequestID := r.URL.Query().Get("approvalRequestId")
	pollToken := r.URL.Query().Get("pollToken")
	approval, err := h.deviceService.ApprovalStatus(r.Context(), approvalRequestID, pollToken)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusUnauthorized)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"approvalRequestId": approval.ID,
		"status":            approval.Status,
		"resolvedAt":        formatNullableTime(approval.ResolvedAt),
	})
}

func (h *Handler) handleRecoveryStart(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.recoveryRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxRecoveryBodyBytes) {
		return
	}

	var req recoveryStartRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	result, err := h.recoveryService.Start(r.Context(), recovery.StartInput{Email: req.Email, ApprovalRequestID: req.ApprovalRequestID})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"recoveryFlowId": result.FlowID,
		"recoveryToken":  result.FlowToken,
		"expiresAt":      result.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *Handler) handleRecoveryComplete(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.recoveryRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxRecoveryBodyBytes) {
		return
	}

	var req recoveryCompleteRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	if err := h.recoveryService.Complete(r.Context(), recovery.CompleteInput{
		FlowID:        req.RecoveryFlowID,
		FlowToken:     req.RecoveryToken,
		RecoveryCode:  req.RecoveryCode,
		TwoFactorCode: req.TwoFactorCode,
	}); err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"completed": true})
}

func (h *Handler) handleSecurityEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}

	events, err := h.eventService.List(r.Context(), principal.AccountID, limit)
	if err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeInternal, "failed to fetch security events"), http.StatusInternalServerError)
		return
	}

	items := make([]securityEventDTO, 0, len(events))
	for _, event := range events {
		items = append(items, mapSecurityEvent(event))
	}

	WriteJSON(w, http.StatusOK, map[string]any{"events": items})
}

func (h *Handler) handleCreateDirectConversation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req createDirectConversationRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	ttl := 0
	if req.DefaultTTLSeconds != nil {
		ttl = *req.DefaultTTLSeconds
	}
	conversation, err := h.messagingService.CreateDirectConversation(r.Context(), principal, req.PeerAccountID, ttl)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]any{"conversation": mapConversation(conversation)})
}

func (h *Handler) handleCreateGroupConversation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req createGroupConversationRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	ttl := 0
	if req.DefaultTTLSeconds != nil {
		ttl = *req.DefaultTTLSeconds
	}
	conversation, err := h.messagingService.CreateGroupConversation(r.Context(), principal, req.Title, req.MemberAccountIDs, ttl)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]any{"conversation": mapConversation(conversation)})
}

func (h *Handler) handleListConversations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	conversations, err := h.messagingService.ListConversations(r.Context(), principal)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	items := make([]conversationDTO, 0, len(conversations))
	for _, conversation := range conversations {
		items = append(items, mapConversation(conversation))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"conversations": items})
}

func (h *Handler) handleConversationSubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	conversationID, action, parseErr := parseConversationRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}

	switch action {
	case "":
		if r.Method != http.MethodGet {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
		conversation, err := h.messagingService.GetConversation(r.Context(), principal, conversationID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"conversation": mapConversation(conversation)})
	case "members":
		if r.Method != http.MethodPost {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
		if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
			return
		}
		var req addConversationMemberRequest
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
		role := domain.ConversationRole(req.Role)
		conversation, err := h.messagingService.AddMember(r.Context(), principal, conversationID, req.MemberAccountID, role)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"conversation": mapConversation(conversation)})
	case "messages":
		if r.Method == http.MethodPost {
			if !h.enforceRateLimit(w, r, h.messageRateLimiter) {
				return
			}
			if !h.enforceBodySize(w, r, maxMessageBodyBytes) {
				return
			}
			var req sendMessageRequest
			if err := middleware.DecodeJSON(r, &req); err != nil {
				WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
				return
			}
			recipients := make([]messaging.RecipientInput, 0, len(req.Recipients))
			for _, recipient := range req.Recipients {
				recipients = append(recipients, messaging.RecipientInput{
					RecipientDeviceID: recipient.RecipientDeviceID,
					WrappedKey:        recipient.WrappedKey,
					KeyAlgorithm:      recipient.KeyAlgorithm,
				})
			}
			message, err := h.messagingService.SendMessage(r.Context(), messaging.SendMessageInput{
				Principal:        principal,
				ConversationID:   conversationID,
				ClientMessageID:  req.ClientMessageID,
				Algorithm:        req.Algorithm,
				CryptoVersion:    req.CryptoVersion,
				Nonce:            req.Nonce,
				Ciphertext:       req.Ciphertext,
				Recipients:       recipients,
				AttachmentIDs:    req.AttachmentIDs,
				ReplyToMessageID: req.ReplyToMessageID,
				TTLSeconds:       req.TTLSeconds,
			})
			if err != nil {
				WriteServiceError(w, r, err, http.StatusBadRequest)
				return
			}
			WriteJSON(w, http.StatusCreated, map[string]any{"message": mapMessage(message)})
			return
		}
		if r.Method == http.MethodGet {
			limit := 50
			if raw := r.URL.Query().Get("limit"); raw != "" {
				if parsed, err := strconv.Atoi(raw); err == nil {
					limit = parsed
				}
			}
			beforeSequence := int64(0)
			if raw := r.URL.Query().Get("beforeSequence"); raw != "" {
				if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
					beforeSequence = parsed
				}
			}
			messages, err := h.messagingService.ListConversationMessages(r.Context(), principal, conversationID, limit, beforeSequence)
			if err != nil {
				WriteServiceError(w, r, err, http.StatusBadRequest)
				return
			}
			items := make([]messageDTO, 0, len(messages))
			nextCursor := int64(0)
			for _, message := range messages {
				items = append(items, mapMessage(message))
				if message.Envelope.ServerSequence > nextCursor {
					nextCursor = message.Envelope.ServerSequence
				}
			}
			WriteJSON(w, http.StatusOK, map[string]any{
				"conversationId": conversationID,
				"messages":       items,
				"nextCursor":     nextCursor,
			})
			return
		}
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
	}
}

func (h *Handler) handleMessageSubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	messageID, action, parseErr := parseMessageRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}

	if action != "receipts" || r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	var req messageReceiptRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	receipt, err := h.messagingService.CreateReceipt(r.Context(), principal, messageID, domain.ReceiptType(req.ReceiptType))
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]any{
		"receipt": map[string]any{
			"id":          receipt.ID,
			"messageId":   receipt.MessageID,
			"deviceId":    receipt.DeviceID,
			"receiptType": receipt.ReceiptType,
			"createdAt":   receipt.CreatedAt.UTC().Format(time.RFC3339),
		},
	})
}

func (h *Handler) handleAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.attachmentRateLimiter) {
		return
	}

	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	if !h.enforceBodySize(w, r, maxAttachmentBodyBytes) {
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	var req attachmentUploadRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}

	attachment, err := h.messagingService.UploadAttachment(r.Context(), messaging.AttachmentUploadInput{
		Principal:      principal,
		Kind:           domain.AttachmentKind(req.Kind),
		FileName:       req.FileName,
		MimeType:       req.MimeType,
		SizeBytes:      req.SizeBytes,
		ChecksumSHA256: req.ChecksumSHA256,
		Algorithm:      req.Algorithm,
		Nonce:          req.Nonce,
		CiphertextB64:  req.Ciphertext,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusCreated, map[string]any{"attachment": mapAttachmentMeta(attachment)})
}

func (h *Handler) handleAttachmentSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	attachmentID, action, parseErr := parseAttachmentRoute(r.URL.Path)
	if parseErr != nil || action != "download" {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}

	result, err := h.messagingService.DownloadAttachment(r.Context(), principal, attachmentID)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"attachment": mapAttachmentMeta(result.Attachment),
		"ciphertext": result.CiphertextB64,
	})
}

func (h *Handler) handleSyncBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	limit := defaultSyncQueryLimit(r.URL.Query().Get("limit"))
	batch, err := h.messagingService.SyncBootstrap(r.Context(), principal, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"batch": mapSyncBatch(batch)})
}

func (h *Handler) handleSyncPoll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	limit := defaultSyncQueryLimit(r.URL.Query().Get("limit"))
	requestedCursor := int64(0)
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			requestedCursor = parsed
		}
	}
	timeout := h.cfg.Transport.LongPollTimeout
	if raw := r.URL.Query().Get("timeoutSec"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 60 {
			timeout = time.Duration(parsed) * time.Second
		}
	}

	batch, err := h.messagingService.SyncPoll(r.Context(), principal, requestedCursor, timeout, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"batch": mapSyncBatch(batch)})
}

func (h *Handler) handleTransportEndpoints(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	profile, endpoints := h.messagingService.ListTransportEndpoints()
	items := make([]transportEndpointDTO, 0, len(endpoints))
	for _, endpoint := range endpoints {
		items = append(items, transportEndpointDTO{
			ID:       endpoint.ID,
			URL:      endpoint.URL,
			Mode:     string(endpoint.Mode),
			Priority: endpoint.Priority,
			Enabled:  endpoint.Enabled,
		})
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"profile": transportProfileDTO{
			Name:                   profile.Name,
			ReconnectBackoffMinMS:  profile.ReconnectBackoffMinMS,
			ReconnectBackoffMaxMS:  profile.ReconnectBackoffMaxMS,
			LongPollTimeoutSeconds: profile.LongPollTimeoutSec,
			LongPollEnabled:        profile.LongPollEnabled,
		},
		"endpoints": items,
	})
}

func (h *Handler) handlePublicConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}

	host := requestHost(r, h.cfg.WebSecurity.TrustProxyHeaders)
	if host == "" {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeInternal, "failed to resolve host"), http.StatusInternalServerError)
		return
	}

	scheme := requestScheme(r, h.cfg.WebSecurity.TrustProxyHeaders)
	wsScheme := "ws"
	if scheme == "https" {
		wsScheme = "wss"
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"api_base":   fmt.Sprintf("%s://%s", scheme, host),
		"ws_url":     fmt.Sprintf("%s://%s%s", wsScheme, host, h.cfg.HTTP.WebSocketPath),
		"api_prefix": h.cfg.HTTP.APIPrefix,
		"policy_hints": publicConfigPolicyHintsDTO{
			AuthModesSupported:            []string{"device", "browser_session"},
			BrowserSessionDefaultPersist:  h.cfg.WebSession.DefaultPersistence,
			BrowserSessionAllowRemembered: h.cfg.WebSession.AllowRemembered,
		},
		"transport_profile_hints": publicConfigTransportHintsDTO{
			ReconnectBackoffMinMS: int(h.cfg.Transport.ReconnectBackoffMin.Milliseconds()),
			ReconnectBackoffMaxMS: int(h.cfg.Transport.ReconnectBackoffMax.Milliseconds()),
			LongPollTimeoutSec:    int(h.cfg.Transport.LongPollTimeout.Seconds()),
			LongPollEnabled:       h.cfg.Transport.LongPollEnabled,
		},
	})
}

func mapSyncBatch(batch messaging.SyncBatch) syncBatchDTO {
	events := make([]syncEventDTO, 0, len(batch.Messages))
	for _, message := range batch.Messages {
		mapped := mapMessage(message)
		events = append(events, syncEventDTO{
			Type:    "message",
			Message: &mapped,
		})
	}
	return syncBatchDTO{
		CursorID:   batch.CursorID,
		FromCursor: batch.FromCursor,
		ToCursor:   batch.ToCursor,
		Events:     events,
		HasMore:    batch.HasMore,
	}
}

func parseConversationRoute(path string) (string, string, error) {
	anchor := "/conversations/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing conversation route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", "", fmt.Errorf("invalid conversation route")
	}
	if len(parts) == 1 {
		return parts[0], "", nil
	}
	return parts[0], parts[1], nil
}

func parseMessageRoute(path string) (string, string, error) {
	anchor := "/messages/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing message route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid message route")
	}
	return parts[0], parts[1], nil
}

func parseAttachmentRoute(path string) (string, string, error) {
	anchor := "/attachments/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing attachment route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid attachment route")
	}
	return parts[0], parts[1], nil
}

func (h *Handler) enforceRateLimit(w http.ResponseWriter, r *http.Request, limiter *middleware.IPRateLimiter) bool {
	if limiter == nil || limiter.Allow(r) {
		return true
	}

	WriteJSON(w, http.StatusTooManyRequests, map[string]any{
		"error": map[string]any{
			"code":       service.ErrorCodeRetryableTransport,
			"message":    "rate limit exceeded",
			"request_id": middleware.RequestIDFromContext(r.Context()),
		},
	})
	return false
}

func (h *Handler) enforceBodySize(w http.ResponseWriter, r *http.Request, maxBytes int64) bool {
	if maxBytes <= 0 {
		return true
	}
	if r.ContentLength > maxBytes {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "request body too large"), http.StatusRequestEntityTooLarge)
		return false
	}
	return true
}

func defaultSyncQueryLimit(raw string) int {
	limit := 100
	if raw == "" {
		return limit
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return limit
	}
	if parsed <= 0 {
		return limit
	}
	if parsed > 200 {
		return 200
	}
	return parsed
}

func requestScheme(r *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
			parts := strings.Split(forwarded, ",")
			candidate := strings.ToLower(strings.TrimSpace(parts[0]))
			if candidate == "https" {
				return "https"
			}
			if candidate == "http" {
				return "http"
			}
		}
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func requestHost(r *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
			parts := strings.Split(forwardedHost, ",")
			candidate := strings.TrimSpace(parts[0])
			if candidate != "" {
				return candidate
			}
		}
	}
	return strings.TrimSpace(r.Host)
}
