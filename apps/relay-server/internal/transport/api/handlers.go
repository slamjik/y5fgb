package api

import (
	"fmt"
	"io"
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
	"github.com/example/secure-messenger/apps/relay-server/internal/service/friends"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/media"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/messaging"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/notifications"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/profile"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/recovery"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/social"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/stories"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/users"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
)

type Handler struct {
	logger                *slog.Logger
	authService           *auth.Service
	deviceService         *devices.Service
	recoveryService       *recovery.Service
	eventService          *securityevents.Service
	messagingService      *messaging.Service
	socialService         *social.Service
	userService           *users.Service
	profileService        *profile.Service
	friendsService        *friends.Service
	privacyService        *privacy.Service
	mediaService          *media.Service
	storiesService        *stories.Service
	notificationsService  *notifications.Service
	cfg                   config.Config
	authRateLimiter       *middleware.IPRateLimiter
	recoveryRateLimiter   *middleware.IPRateLimiter
	messageRateLimiter    *middleware.IPRateLimiter
	attachmentRateLimiter *middleware.IPRateLimiter
	socialRateLimiter     *middleware.IPRateLimiter
	mediaRateLimiter      *middleware.IPRateLimiter
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
	socialService *social.Service,
	userService *users.Service,
	profileService *profile.Service,
	friendsService *friends.Service,
	privacyService *privacy.Service,
	mediaService *media.Service,
	storiesService *stories.Service,
	notificationsService *notifications.Service,
	cfg config.Config,
) *Handler {
	return &Handler{
		logger:                logger,
		authService:           authService,
		deviceService:         deviceService,
		recoveryService:       recoveryService,
		eventService:          eventService,
		messagingService:      messagingService,
		socialService:         socialService,
		userService:           userService,
		profileService:        profileService,
		friendsService:        friendsService,
		privacyService:        privacyService,
		mediaService:          mediaService,
		storiesService:        storiesService,
		notificationsService:  notificationsService,
		cfg:                   cfg,
		authRateLimiter:       middleware.NewIPRateLimiter(30, time.Minute, nil),
		recoveryRateLimiter:   middleware.NewIPRateLimiter(10, time.Minute, nil),
		messageRateLimiter:    middleware.NewIPRateLimiter(180, time.Minute, nil),
		attachmentRateLimiter: middleware.NewIPRateLimiter(60, time.Minute, nil),
		socialRateLimiter:     middleware.NewIPRateLimiter(120, time.Minute, nil),
		mediaRateLimiter:      middleware.NewIPRateLimiter(30, time.Minute, nil),
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
	mux.Handle(base+"/conversations/summaries", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleListConversationSummaries)))
	mux.Handle(base+"/conversations/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleConversationSubroutes)))
	mux.Handle(base+"/users/search", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleUserSearch)))
	mux.Handle(base+"/users/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleUserSubroutes)))
	mux.Handle(base+"/messages/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleMessageSubroutes)))
	mux.Handle(base+"/attachments/upload", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleAttachmentUpload)))
	mux.Handle(base+"/attachments/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleAttachmentSubroutes)))
	mux.Handle(base+"/sync/bootstrap", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSyncBootstrap)))
	mux.Handle(base+"/sync/poll", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSyncPoll)))
	mux.Handle(base+"/transport/endpoints", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleTransportEndpoints)))
	mux.Handle(base+"/social/posts", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSocialPosts)))
	mux.Handle(base+"/social/posts/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSocialPostSubroutes)))
	mux.Handle(base+"/social/notifications", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleSocialNotifications)))
	mux.Handle(base+"/profiles/me", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleMyProfile)))
	mux.Handle(base+"/profiles/search", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleProfileSearch)))
	mux.Handle(base+"/profiles/by-username/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleProfileByUsername)))
	mux.Handle(base+"/profiles/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleProfileSubroutes)))
	mux.Handle(base+"/friends", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleFriends)))
	mux.Handle(base+"/friends/requests", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleFriendRequests)))
	mux.Handle(base+"/friends/requests/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleFriendRequestSubroutes)))
	mux.Handle(base+"/friends/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleFriendSubroutes)))
	mux.Handle(base+"/privacy/me", middleware.AuthRequired(authService, http.HandlerFunc(handler.handlePrivacyMe)))
	mux.Handle(base+"/media/upload", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleMediaUpload)))
	mux.Handle(base+"/media/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleMediaSubroutes)))
	mux.Handle(base+"/stories", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleStories)))
	mux.Handle(base+"/stories/feed", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleStoryFeed)))
	mux.Handle(base+"/stories/", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleStorySubroutes)))
	mux.Handle(base+"/notifications", middleware.AuthRequired(authService, http.HandlerFunc(handler.handleNotifications)))
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
		Email:    req.Email,
		Password: req.Password,
		Device: auth.DeviceInput{
			DeviceID:             req.Device.DeviceID,
			Name:                 req.Device.Name,
			Platform:             req.Device.Platform,
			PublicDeviceMaterial: req.Device.PublicDeviceMaterial,
			Fingerprint:          req.Device.Fingerprint,
		},
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
		Email:    req.Email,
		Password: req.Password,
		Device: auth.DeviceInput{
			DeviceID:             req.Device.DeviceID,
			Name:                 req.Device.Name,
			Platform:             req.Device.Platform,
			PublicDeviceMaterial: req.Device.PublicDeviceMaterial,
			Fingerprint:          req.Device.Fingerprint,
		},
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
		ChallengeID: req.ChallengeID,
		LoginToken:  req.LoginToken,
		Code:        req.Code,
		Device: &auth.DeviceInput{
			DeviceID:             req.Device.DeviceID,
			Name:                 req.Device.Name,
			Platform:             req.Device.Platform,
			PublicDeviceMaterial: req.Device.PublicDeviceMaterial,
			Fingerprint:          req.Device.Fingerprint,
		},
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

func (h *Handler) handleListConversationSummaries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			offset = parsed
		}
	}

	result, err := h.messagingService.ListConversationSummaries(r.Context(), principal, limit, offset)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	summaries := make([]conversationSummaryDTO, 0, len(result.Summaries))
	for _, summary := range result.Summaries {
		summaries = append(summaries, mapConversationSummary(summary))
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"summaries": summaries,
		"total":     result.Total,
		"offset":    result.Offset,
		"limit":     result.Limit,
	})
}

func (h *Handler) handleUserSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("query"))
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}

	items, err := h.profileService.SearchProfiles(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, query, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	usersPayload := make([]userSearchItemDTO, 0, len(items))
	for _, item := range items {
		usersPayload = append(usersPayload, mapUserSearchItem(item))
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"users": usersPayload,
		"total": len(usersPayload),
		"limit": limit,
	})
}

func (h *Handler) handleProfileSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.profileService.SearchProfiles(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, query, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	payload := make([]userSearchItemDTO, 0, len(items))
	for _, item := range items {
		payload = append(payload, mapUserSearchItem(item))
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"users": payload,
		"total": len(payload),
		"limit": limit,
	})
}

func (h *Handler) handleProfileByUsername(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	username, parseErr := parseProfileByUsernameRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	profile, err := h.profileService.GetProfileByUsername(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, username)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"profile": mapProfile(profile)})
}

func (h *Handler) handleMyProfile(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}
	switch r.Method {
	case http.MethodGet:
		profilePayload, err := h.profileService.GetMyProfile(r.Context(), authPrincipal)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"profile": mapProfile(profilePayload)})
		return
	case http.MethodPatch:
		if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
			return
		}
		var req updateProfileRequest
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
		updateInput := profile.UpdateInput{
			DisplayName:   req.DisplayName,
			Username:      req.Username,
			Bio:           req.Bio,
			StatusText:    req.StatusText,
			Location:      req.Location,
			WebsiteURL:    req.WebsiteURL,
			AvatarMediaID: req.AvatarMediaID,
			BannerMediaID: req.BannerMediaID,
		}
		if req.BirthDate != nil {
			updateInput.BirthDateSet = true
			trimmedBirthDate := strings.TrimSpace(*req.BirthDate)
			if trimmedBirthDate == "" {
				updateInput.BirthDate = nil
			} else {
				parsed, err := time.Parse("2006-01-02", trimmedBirthDate)
				if err != nil {
					WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "birthDate must use YYYY-MM-DD"), http.StatusBadRequest)
					return
				}
				utc := parsed.UTC()
				updateInput.BirthDate = &utc
			}
		}

		if _, err := h.profileService.UpdateProfile(r.Context(), authPrincipal, updateInput); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		profilePayload, err := h.profileService.GetMyProfile(r.Context(), authPrincipal)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"profile": mapProfile(profilePayload)})
		return
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
}

func (h *Handler) handleProfileSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	accountID, parseErr := parseProfileRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	profilePayload, err := h.profileService.GetProfileByAccountID(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, accountID)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"profile": mapProfile(profilePayload)})
}

func (h *Handler) handlePrivacyMe(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}

	switch r.Method {
	case http.MethodGet:
		settings, err := h.privacyService.GetSettings(r.Context(), authPrincipal.AccountID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"privacy": mapProfilePrivacy(settings)})
		return
	case http.MethodPatch:
		if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
			return
		}
		var req updatePrivacyRequest
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
		input := privacy.UpdateInput{
			ProfileVisibility:    parseVisibilityPointer(req.ProfileVisibility),
			PostsVisibility:      parseVisibilityPointer(req.PostsVisibility),
			PhotosVisibility:     parseVisibilityPointer(req.PhotosVisibility),
			StoriesVisibility:    parseVisibilityPointer(req.StoriesVisibility),
			FriendsVisibility:    parseVisibilityPointer(req.FriendsVisibility),
			BirthDateVisibility:  parseVisibilityPointer(req.BirthDateVisibility),
			LocationVisibility:   parseVisibilityPointer(req.LocationVisibility),
			LinksVisibility:      parseVisibilityPointer(req.LinksVisibility),
			FriendRequestsPolicy: parseFriendRequestPolicyPointer(req.FriendRequestsPolicy),
			DMPolicy:             parseDMPolicyPointer(req.DMPolicy),
		}
		settings, err := h.privacyService.UpdateSettings(r.Context(), authPrincipal.AccountID, input)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"privacy": mapProfilePrivacy(settings)})
		return
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
}

func (h *Handler) handleFriends(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.friendsService.ListFriends(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	payload := make([]friendListItemDTO, 0, len(items))
	for _, item := range items {
		payload = append(payload, mapFriendListItem(item))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"friends": payload, "total": len(payload)})
}

func (h *Handler) handleFriendRequests(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}
	switch r.Method {
	case http.MethodGet:
		limit := 50
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		direction := strings.TrimSpace(r.URL.Query().Get("direction"))
		if direction == "" {
			direction = "incoming"
		}
		items, err := h.friendsService.ListRequests(r.Context(), authPrincipal, direction, limit)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		payload := make([]friendRequestDTO, 0, len(items))
		for _, item := range items {
			payload = append(payload, mapFriendRequest(item))
		}
		WriteJSON(w, http.StatusOK, map[string]any{"requests": payload, "total": len(payload), "direction": direction})
		return
	case http.MethodPost:
		if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
			return
		}
		var req createFriendRequestBody
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}
		created, err := h.friendsService.SendRequest(r.Context(), authPrincipal, req.TargetAccountID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusCreated, map[string]any{
			"request": map[string]any{
				"id":            created.ID,
				"fromAccountId": created.FromAccountID,
				"toAccountId":   created.ToAccountID,
				"status":        created.Status,
				"createdAt":     created.CreatedAt.UTC().Format(time.RFC3339),
				"updatedAt":     created.UpdatedAt.UTC().Format(time.RFC3339),
			},
		})
		return
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
}

func (h *Handler) handleFriendRequestSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	requestID, action, parseErr := parseFriendRequestRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}
	var (
		updated domain.FriendRequest
		err     error
	)
	switch action {
	case "accept":
		updated, err = h.friendsService.AcceptRequest(r.Context(), authPrincipal, requestID)
	case "reject":
		updated, err = h.friendsService.RejectRequest(r.Context(), authPrincipal, requestID)
	case "cancel":
		updated, err = h.friendsService.CancelRequest(r.Context(), authPrincipal, requestID)
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"request": map[string]any{
			"id":            updated.ID,
			"fromAccountId": updated.FromAccountID,
			"toAccountId":   updated.ToAccountID,
			"status":        updated.Status,
			"createdAt":     updated.CreatedAt.UTC().Format(time.RFC3339),
			"updatedAt":     updated.UpdatedAt.UTC().Format(time.RFC3339),
		},
	})
}

func (h *Handler) handleFriendSubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	targetAccountID, action, parseErr := parseFriendRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}

	if action == "" {
		if r.Method != http.MethodDelete {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
		if err := h.friendsService.RemoveFriend(r.Context(), authPrincipal, targetAccountID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	if action != "block" {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	switch r.Method {
	case http.MethodPost:
		if err := h.friendsService.Block(r.Context(), authPrincipal, targetAccountID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	case http.MethodDelete:
		if err := h.friendsService.Unblock(r.Context(), authPrincipal, targetAccountID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleMediaUpload(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.mediaRateLimiter) {
		return
	}
	if r.Method != http.MethodPost {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	if !h.enforceBodySize(w, r, maxAttachmentBodyBytes*2) {
		return
	}
	if err := r.ParseMultipartForm(maxAttachmentBodyBytes * 2); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid multipart body"), http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "file is required"), http.StatusBadRequest)
		return
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, maxAttachmentBodyBytes*2+1))
	if err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "failed to read file"), http.StatusBadRequest)
		return
	}
	if len(payload) == 0 {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "empty file payload"), http.StatusBadRequest)
		return
	}
	mediaDomain := domain.MediaDomain(strings.ToLower(strings.TrimSpace(r.FormValue("domain"))))
	mediaKind := domain.MediaKind(strings.ToLower(strings.TrimSpace(r.FormValue("kind"))))
	visibility := domain.VisibilityScope(strings.ToLower(strings.TrimSpace(r.FormValue("visibility"))))
	if visibility == "" {
		visibility = domain.VisibilityFriends
	}
	mimeType := strings.TrimSpace(r.FormValue("mimeType"))

	created, createErr := h.mediaService.Upload(r.Context(), media.UploadInput{
		Principal: auth.AuthPrincipal{
			AccountID: principal.AccountID,
			DeviceID:  principal.DeviceID,
			SessionID: principal.SessionID,
		},
		Domain:     mediaDomain,
		Kind:       mediaKind,
		Visibility: visibility,
		FileName:   header.Filename,
		MimeType:   mimeType,
		Payload:    payload,
	})
	if createErr != nil {
		WriteServiceError(w, r, createErr, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"media": mapMedia(created, h.cfg.HTTP.APIPrefix)})
}

func (h *Handler) handleMediaSubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	mediaID, action, parseErr := parseMediaRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}

	if action == "content" {
		if r.Method != http.MethodGet {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
		result, err := h.mediaService.Download(r.Context(), authPrincipal, mediaID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", result.Media.MimeType)
		w.Header().Set("Content-Length", strconv.FormatInt(int64(len(result.Content)), 10))
		w.Header().Set("Cache-Control", "private, max-age=120")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(result.Content)
		return
	}

	switch r.Method {
	case http.MethodGet:
		mediaMetadata, err := h.mediaService.GetMedia(r.Context(), authPrincipal, mediaID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"media": mapMedia(mediaMetadata, h.cfg.HTTP.APIPrefix)})
	case http.MethodDelete:
		if err := h.mediaService.Delete(r.Context(), authPrincipal, mediaID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleStories(w http.ResponseWriter, r *http.Request) {
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
	var req createStoryRequest
	if err := middleware.DecodeJSON(r, &req); err != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
		return
	}
	var visibility *domain.VisibilityScope
	if req.Visibility != nil {
		value := domain.VisibilityScope(strings.ToLower(strings.TrimSpace(*req.Visibility)))
		visibility = &value
	}
	created, err := h.storiesService.Create(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, stories.CreateInput{
		MediaID:    req.MediaID,
		Caption:    req.Caption,
		Visibility: visibility,
	})
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"story": mapStory(created, h.cfg.HTTP.APIPrefix)})
}

func (h *Handler) handleStoryFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	limit := 60
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.storiesService.Feed(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	payload := make([]storyDTO, 0, len(items))
	for _, item := range items {
		payload = append(payload, mapStory(item, h.cfg.HTTP.APIPrefix))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"stories": payload, "total": len(payload)})
}

func (h *Handler) handleStorySubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	storyID, parseErr := parseStoryRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}
	authPrincipal := auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}
	switch r.Method {
	case http.MethodGet:
		item, err := h.storiesService.GetByID(r.Context(), authPrincipal, storyID)
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"story": mapStory(item, h.cfg.HTTP.APIPrefix)})
	case http.MethodDelete:
		if err := h.storiesService.Delete(r.Context(), authPrincipal, storyID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleNotifications(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.notificationsService.List(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	payload := make([]appNotificationDTO, 0, len(items))
	for _, item := range items {
		payload = append(payload, mapAppNotification(item))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"notifications": payload, "total": len(payload)})
}

func (h *Handler) handleUserSubroutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	accountID, action, parseErr := parseUserRoute(r.URL.Path)
	if parseErr != nil || action != "profile" {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}

	profilePayload, err := h.profileService.GetProfileByAccountID(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, accountID)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"accountId":                    profilePayload.AccountID,
		"email":                        profilePayload.Email,
		"createdAt":                    profilePayload.CreatedAt.UTC().Format(time.RFC3339),
		"postCount":                    profilePayload.PostCount,
		"canStartDirectChat":           profilePayload.CanStartDirectChat,
		"existingDirectConversationId": profilePayload.ExistingDirectConversation,
		"displayName":                  profilePayload.DisplayName,
		"username":                     profilePayload.Username,
		"avatarMediaId":                profilePayload.AvatarMediaID,
		"bannerMediaId":                profilePayload.BannerMediaID,
		"friendState":                  profilePayload.FriendState,
	})
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

func (h *Handler) handleSocialPosts(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !h.enforceRateLimit(w, r, h.socialRateLimiter) {
			return
		}
		limit := 20
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				limit = parsed
			}
		}
		offset := 0
		if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil {
				offset = parsed
			}
		}
		query := strings.TrimSpace(r.URL.Query().Get("query"))
		onlyMine := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("scope")), "mine")

		var mediaType *domain.SocialMediaType
		if rawMediaType := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("mediaType"))); rawMediaType != "" {
			value := domain.SocialMediaType(rawMediaType)
			mediaType = &value
		}

		items, err := h.socialService.ListPosts(r.Context(), auth.AuthPrincipal{
			AccountID: principal.AccountID,
			DeviceID:  principal.DeviceID,
			SessionID: principal.SessionID,
		}, social.ListPostsInput{
			Offset:    offset,
			Limit:     limit,
			MediaType: mediaType,
			Query:     query,
			OnlyMine:  onlyMine,
		})
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		payload := make([]socialPostDTO, 0, len(items))
		for _, item := range items {
			payload = append(payload, mapSocialPost(item, principal.AccountID))
		}
		WriteJSON(w, http.StatusOK, map[string]any{"posts": payload})
		return
	case http.MethodPost:
		if !h.enforceRateLimit(w, r, h.socialRateLimiter) {
			return
		}
		if !h.enforceBodySize(w, r, maxAuthBodyBytes) {
			return
		}
		var req createSocialPostRequest
		if err := middleware.DecodeJSON(r, &req); err != nil {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "invalid request body"), http.StatusBadRequest)
			return
		}

		var mediaType *domain.SocialMediaType
		if req.MediaType != nil {
			value := domain.SocialMediaType(strings.ToLower(strings.TrimSpace(*req.MediaType)))
			mediaType = &value
		}

		created, err := h.socialService.CreatePost(r.Context(), auth.AuthPrincipal{
			AccountID: principal.AccountID,
			DeviceID:  principal.DeviceID,
			SessionID: principal.SessionID,
		}, social.CreatePostInput{
			Content:   req.Content,
			MediaType: mediaType,
			MediaURL:  req.MediaURL,
			MediaID:   req.MediaID,
			Mood:      req.Mood,
		})
		if err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusCreated, map[string]any{"post": mapSocialPost(created, principal.AccountID)})
		return
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
	}
}

func (h *Handler) handleSocialPostSubroutes(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}

	postID, action, parseErr := parseSocialPostRoute(r.URL.Path)
	if parseErr != nil {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
		return
	}

	switch action {
	case "":
		if r.Method != http.MethodDelete {
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
		if err := h.socialService.DeletePost(r.Context(), auth.AuthPrincipal{
			AccountID: principal.AccountID,
			DeviceID:  principal.DeviceID,
			SessionID: principal.SessionID,
		}, postID); err != nil {
			WriteServiceError(w, r, err, http.StatusBadRequest)
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	case "like":
		if !h.enforceRateLimit(w, r, h.socialRateLimiter) {
			return
		}
		switch r.Method {
		case http.MethodPost:
			likeCount, likedByMe, err := h.socialService.LikePost(r.Context(), auth.AuthPrincipal{
				AccountID: principal.AccountID,
				DeviceID:  principal.DeviceID,
				SessionID: principal.SessionID,
			}, postID)
			if err != nil {
				WriteServiceError(w, r, err, http.StatusBadRequest)
				return
			}
			WriteJSON(w, http.StatusOK, map[string]any{"likeCount": likeCount, "likedByMe": likedByMe})
			return
		case http.MethodDelete:
			likeCount, likedByMe, err := h.socialService.UnlikePost(r.Context(), auth.AuthPrincipal{
				AccountID: principal.AccountID,
				DeviceID:  principal.DeviceID,
				SessionID: principal.SessionID,
			}, postID)
			if err != nil {
				WriteServiceError(w, r, err, http.StatusBadRequest)
				return
			}
			WriteJSON(w, http.StatusOK, map[string]any{"likeCount": likeCount, "likedByMe": likedByMe})
			return
		default:
			WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
			return
		}
	default:
		WriteServiceError(w, r, service.NewError(service.ErrorCodeNotFound, "route not found"), http.StatusNotFound)
	}
}

func (h *Handler) handleSocialNotifications(w http.ResponseWriter, r *http.Request) {
	if !h.enforceRateLimit(w, r, h.socialRateLimiter) {
		return
	}
	if r.Method != http.MethodGet {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeValidation, "method not allowed"), http.StatusMethodNotAllowed)
		return
	}
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		WriteServiceError(w, r, service.NewError(service.ErrorCodeUnauthorized, "missing auth context"), http.StatusUnauthorized)
		return
	}
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.socialService.ListNotifications(r.Context(), auth.AuthPrincipal{
		AccountID: principal.AccountID,
		DeviceID:  principal.DeviceID,
		SessionID: principal.SessionID,
	}, limit)
	if err != nil {
		WriteServiceError(w, r, err, http.StatusBadRequest)
		return
	}
	payload := make([]socialNotificationDTO, 0, len(items))
	for _, item := range items {
		payload = append(payload, mapSocialNotification(item))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"notifications": payload})
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

func parseSocialPostRoute(path string) (string, string, error) {
	anchor := "/social/posts/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing social post route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", "", fmt.Errorf("invalid social post route")
	}
	if len(parts) == 1 {
		return parts[0], "", nil
	}
	return parts[0], parts[1], nil
}

func parseUserRoute(path string) (string, string, error) {
	anchor := "/users/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing user route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid user route")
	}
	return parts[0], parts[1], nil
}

func parseProfileRoute(path string) (string, error) {
	anchor := "/profiles/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", fmt.Errorf("missing profile route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", fmt.Errorf("invalid profile route")
	}
	if len(parts) != 1 {
		return "", fmt.Errorf("invalid profile route")
	}
	return parts[0], nil
}

func parseProfileByUsernameRoute(path string) (string, error) {
	anchor := "/profiles/by-username/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", fmt.Errorf("missing username profile route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	if tail == "" || strings.Contains(tail, "/") {
		return "", fmt.Errorf("invalid username profile route")
	}
	return tail, nil
}

func parseFriendRequestRoute(path string) (string, string, error) {
	anchor := "/friends/requests/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing friend request route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid friend request route")
	}
	return parts[0], parts[1], nil
}

func parseFriendRoute(path string) (string, string, error) {
	anchor := "/friends/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing friend route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", "", fmt.Errorf("invalid friend route")
	}
	if len(parts) == 1 {
		return parts[0], "", nil
	}
	return parts[0], parts[1], nil
}

func parseMediaRoute(path string) (string, string, error) {
	anchor := "/media/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", "", fmt.Errorf("missing media route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", "", fmt.Errorf("invalid media route")
	}
	if len(parts) == 1 {
		return parts[0], "", nil
	}
	return parts[0], parts[1], nil
}

func parseStoryRoute(path string) (string, error) {
	anchor := "/stories/"
	index := strings.Index(path, anchor)
	if index == -1 {
		return "", fmt.Errorf("missing story route")
	}
	tail := strings.Trim(path[index+len(anchor):], "/")
	if tail == "" || strings.Contains(tail, "/") {
		return "", fmt.Errorf("invalid story route")
	}
	return tail, nil
}

func parseVisibilityPointer(raw *string) *domain.VisibilityScope {
	if raw == nil {
		return nil
	}
	value := domain.VisibilityScope(strings.ToLower(strings.TrimSpace(*raw)))
	return &value
}

func parseFriendRequestPolicyPointer(raw *string) *domain.FriendRequestPolicy {
	if raw == nil {
		return nil
	}
	value := domain.FriendRequestPolicy(strings.ToLower(strings.TrimSpace(*raw)))
	return &value
}

func parseDMPolicyPointer(raw *string) *domain.DMPolicy {
	if raw == nil {
		return nil
	}
	value := domain.DMPolicy(strings.ToLower(strings.TrimSpace(*raw)))
	return &value
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
