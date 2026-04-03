package api

import (
	"encoding/json"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/messaging"
)

type registerRequest struct {
	Email                      string `json:"email"`
	Password                   string `json:"password"`
	AccountIdentityMaterial    string `json:"accountIdentityMaterial"`
	AccountIdentityFingerprint string `json:"accountIdentityFingerprint,omitempty"`
	Device                     struct {
		DeviceID             string `json:"deviceId,omitempty"`
		Name                 string `json:"name"`
		Platform             string `json:"platform"`
		PublicDeviceMaterial string `json:"publicDeviceMaterial"`
		Fingerprint          string `json:"fingerprint,omitempty"`
	} `json:"device"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Device   struct {
		DeviceID             string `json:"deviceId,omitempty"`
		Name                 string `json:"name"`
		Platform             string `json:"platform"`
		PublicDeviceMaterial string `json:"publicDeviceMaterial"`
		Fingerprint          string `json:"fingerprint,omitempty"`
	} `json:"device"`
}

type webLoginRequest struct {
	Email              string `json:"email"`
	Password           string `json:"password"`
	SessionPersistence string `json:"sessionPersistence,omitempty"`
}

type twoFALoginVerifyRequest struct {
	ChallengeID string `json:"challengeId"`
	LoginToken  string `json:"loginToken"`
	Code        string `json:"code"`
}

type webTwoFALoginVerifyRequest struct {
	ChallengeID        string `json:"challengeId"`
	LoginToken         string `json:"loginToken"`
	Code               string `json:"code"`
	SessionPersistence string `json:"sessionPersistence,omitempty"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type webRefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type logoutRequest struct {
	RefreshToken string `json:"refreshToken,omitempty"`
}

type webLogoutRequest struct {
	RefreshToken string `json:"refreshToken,omitempty"`
}

type twoFAConfirmRequest struct {
	Code string `json:"code"`
}

type twoFADisableRequest struct {
	Code string `json:"code"`
}

type deviceApproveRequest struct {
	ApprovalRequestID string `json:"approvalRequestId"`
	TwoFactorCode     string `json:"twoFactorCode,omitempty"`
}

type deviceRejectRequest struct {
	ApprovalRequestID string `json:"approvalRequestId"`
	TwoFactorCode     string `json:"twoFactorCode,omitempty"`
}

type deviceRevokeRequest struct {
	DeviceID      string `json:"deviceId"`
	TwoFactorCode string `json:"twoFactorCode,omitempty"`
}

type deviceRotateKeyRequest struct {
	PublicDeviceMaterial string `json:"publicDeviceMaterial"`
	Fingerprint          string `json:"fingerprint,omitempty"`
	TwoFactorCode        string `json:"twoFactorCode,omitempty"`
}

type recoveryStartRequest struct {
	Email             string `json:"email"`
	ApprovalRequestID string `json:"approvalRequestId"`
}

type recoveryCompleteRequest struct {
	RecoveryFlowID string `json:"recoveryFlowId"`
	RecoveryToken  string `json:"recoveryToken"`
	RecoveryCode   string `json:"recoveryCode"`
	TwoFactorCode  string `json:"twoFactorCode,omitempty"`
}

type envelopeResponse struct {
	AccountID     string      `json:"accountId"`
	Identity      identityDTO `json:"identity"`
	Device        deviceDTO   `json:"device"`
	Session       sessionDTO  `json:"session"`
	Tokens        tokensDTO   `json:"tokens"`
	RecoveryCodes []string    `json:"recoveryCodes,omitempty"`
}

type identityDTO struct {
	AccountID              string         `json:"accountId"`
	PublicIdentityMaterial string         `json:"publicIdentityMaterial"`
	Fingerprint            fingerprintDTO `json:"fingerprint"`
	VerificationState      string         `json:"verificationState"`
	TrustState             string         `json:"trustState"`
	CreatedAt              string         `json:"createdAt"`
	UpdatedAt              string         `json:"updatedAt"`
}

type fingerprintDTO struct {
	Algorithm    string `json:"algorithm"`
	Value        string `json:"value"`
	SafetyNumber string `json:"safetyNumber"`
}

type deviceDTO struct {
	ID                   string           `json:"id"`
	AccountID            string           `json:"accountId"`
	Name                 string           `json:"name"`
	Platform             string           `json:"platform"`
	PublicDeviceMaterial string           `json:"publicDeviceMaterial"`
	Fingerprint          fingerprintDTO   `json:"fingerprint"`
	Status               string           `json:"status"`
	VerificationState    string           `json:"verificationState"`
	KeyInfo              deviceKeyInfoDTO `json:"keyInfo"`
	CreatedAt            string           `json:"createdAt"`
	LastSeenAt           *string          `json:"lastSeenAt"`
	RevokedAt            *string          `json:"revokedAt"`
}

type deviceKeyInfoDTO struct {
	Version             int     `json:"version"`
	RotatedAt           *string `json:"rotatedAt"`
	RotationDueAt       *string `json:"rotationDueAt"`
	RotationRecommended bool    `json:"rotationRecommended"`
}

type sessionDTO struct {
	ID                    string   `json:"id"`
	AccountID             string   `json:"accountId"`
	DeviceID              string   `json:"deviceId"`
	Status                string   `json:"status"`
	ClientPlatform        string   `json:"clientPlatform,omitempty"`
	SessionClass          string   `json:"sessionClass,omitempty"`
	Persistent            bool     `json:"persistent,omitempty"`
	AccessTokenExpiresAt  string   `json:"accessTokenExpiresAt"`
	RefreshTokenExpiresAt string   `json:"refreshTokenExpiresAt"`
	CreatedAt             string   `json:"createdAt"`
	LastSeenAt            *string  `json:"lastSeenAt"`
	TrustWarnings         []string `json:"trustWarnings,omitempty"`
}

type tokensDTO struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	TokenType        string `json:"tokenType"`
	ExpiresInSeconds int64  `json:"expiresInSeconds"`
}

type approvalDTO struct {
	ID         string  `json:"id"`
	AccountID  string  `json:"accountId"`
	DeviceID   string  `json:"deviceId"`
	Status     string  `json:"status"`
	CreatedAt  string  `json:"createdAt"`
	ResolvedAt *string `json:"resolvedAt"`
}

type securityEventDTO struct {
	ID         string          `json:"id"`
	AccountID  string          `json:"accountId"`
	DeviceID   *string         `json:"deviceId"`
	EventType  string          `json:"eventType"`
	Severity   string          `json:"severity"`
	TrustState string          `json:"trustState"`
	Metadata   json.RawMessage `json:"metadata"`
	CreatedAt  string          `json:"createdAt"`
}

type createDirectConversationRequest struct {
	PeerAccountID     string `json:"peerAccountId"`
	DefaultTTLSeconds *int   `json:"defaultTtlSeconds,omitempty"`
}

type createGroupConversationRequest struct {
	Title             string   `json:"title"`
	MemberAccountIDs  []string `json:"memberAccountIds"`
	DefaultTTLSeconds *int     `json:"defaultTtlSeconds,omitempty"`
}

type addConversationMemberRequest struct {
	MemberAccountID string `json:"memberAccountId"`
	Role            string `json:"role,omitempty"`
}

type sendMessageRequest struct {
	ClientMessageID string `json:"clientMessageId"`
	Algorithm       string `json:"algorithm"`
	CryptoVersion   int    `json:"cryptoVersion"`
	Nonce           string `json:"nonce"`
	Ciphertext      string `json:"ciphertext"`
	Recipients      []struct {
		RecipientDeviceID string `json:"recipientDeviceId"`
		WrappedKey        string `json:"wrappedKey"`
		KeyAlgorithm      string `json:"keyAlgorithm"`
	} `json:"recipients"`
	AttachmentIDs    []string `json:"attachmentIds,omitempty"`
	ReplyToMessageID *string  `json:"replyToMessageId,omitempty"`
	TTLSeconds       *int     `json:"ttlSeconds,omitempty"`
}

type messageReceiptRequest struct {
	ReceiptType string `json:"receiptType"`
}

type attachmentUploadRequest struct {
	Kind           string `json:"kind"`
	FileName       string `json:"fileName"`
	MimeType       string `json:"mimeType"`
	SizeBytes      int64  `json:"sizeBytes"`
	ChecksumSHA256 string `json:"checksumSha256"`
	Algorithm      string `json:"algorithm"`
	Nonce          string `json:"nonce"`
	Ciphertext     string `json:"ciphertext"`
}

type conversationDTO struct {
	ID                 string                  `json:"id"`
	Type               string                  `json:"type"`
	Title              *string                 `json:"title"`
	CreatedByAccountID string                  `json:"createdByAccountId"`
	CreatedAt          string                  `json:"createdAt"`
	UpdatedAt          string                  `json:"updatedAt"`
	DisappearingPolicy disappearingPolicyDTO   `json:"disappearingPolicy"`
	Members            []conversationMemberDTO `json:"members"`
	LastServerSequence int64                   `json:"lastServerSequence"`
}

type disappearingPolicyDTO struct {
	DefaultTTLSeconds       int  `json:"defaultTtlSeconds"`
	AllowPerMessageOverride bool `json:"allowPerMessageOverride"`
}

type conversationMemberDTO struct {
	AccountID      string      `json:"accountId"`
	Role           string      `json:"role"`
	JoinedAt       string      `json:"joinedAt"`
	IsActive       bool        `json:"isActive"`
	TrustedDevices []deviceDTO `json:"trustedDevices"`
}

type messageDTO struct {
	Envelope      encryptedEnvelopeDTO `json:"envelope"`
	DeliveryState string               `json:"deliveryState"`
	DeliveredAt   *string              `json:"deliveredAt"`
	FailedReason  *string              `json:"failedReason"`
	Receipts      []messageReceiptDTO  `json:"receipts"`
}

type encryptedEnvelopeDTO struct {
	ID               string              `json:"id"`
	ConversationID   string              `json:"conversationId"`
	SenderAccountID  string              `json:"senderAccountId"`
	SenderDeviceID   string              `json:"senderDeviceId"`
	ClientMessageID  string              `json:"clientMessageId"`
	Algorithm        string              `json:"algorithm"`
	CryptoVersion    int                 `json:"cryptoVersion"`
	Nonce            string              `json:"nonce"`
	Ciphertext       string              `json:"ciphertext"`
	Recipients       []recipientKeyDTO   `json:"recipients"`
	Attachments      []attachmentMetaDTO `json:"attachments"`
	ReplyToMessageID *string             `json:"replyToMessageId"`
	TTLSeconds       *int                `json:"ttlSeconds"`
	CreatedAt        string              `json:"createdAt"`
	ExpiresAt        *string             `json:"expiresAt"`
	ServerSequence   int64               `json:"serverSequence"`
}

type recipientKeyDTO struct {
	RecipientDeviceID string `json:"recipientDeviceId"`
	WrappedKey        string `json:"wrappedKey"`
	KeyAlgorithm      string `json:"keyAlgorithm"`
}

type attachmentMetaDTO struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	FileName       string `json:"fileName"`
	MimeType       string `json:"mimeType"`
	SizeBytes      int64  `json:"sizeBytes"`
	ChecksumSHA256 string `json:"checksumSha256"`
	Encryption     struct {
		Algorithm string `json:"algorithm"`
		Nonce     string `json:"nonce"`
	} `json:"encryption"`
	CreatedAt string `json:"createdAt"`
}

type messageReceiptDTO struct {
	ID          string `json:"id"`
	MessageID   string `json:"messageId"`
	DeviceID    string `json:"deviceId"`
	ReceiptType string `json:"receiptType"`
	CreatedAt   string `json:"createdAt"`
}

type syncEventDTO struct {
	Type    string      `json:"type"`
	Message *messageDTO `json:"message,omitempty"`
}

type syncBatchDTO struct {
	CursorID   string         `json:"cursorId"`
	FromCursor int64          `json:"fromCursor"`
	ToCursor   int64          `json:"toCursor"`
	Events     []syncEventDTO `json:"events"`
	HasMore    bool           `json:"hasMore"`
}

type transportEndpointDTO struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Mode     string `json:"mode"`
	Priority int    `json:"priority"`
	Enabled  bool   `json:"enabled"`
}

type transportProfileDTO struct {
	Name                   string `json:"name"`
	ReconnectBackoffMinMS  int    `json:"reconnectBackoffMinMs"`
	ReconnectBackoffMaxMS  int    `json:"reconnectBackoffMaxMs"`
	LongPollTimeoutSeconds int    `json:"longPollTimeoutSeconds"`
	LongPollEnabled        bool   `json:"longPollEnabled"`
}

type publicConfigPolicyHintsDTO struct {
	AuthModesSupported             []string `json:"auth_modes_supported"`
	BrowserSessionDefaultPersist   string   `json:"browser_session_default_persistence"`
	BrowserSessionAllowRemembered  bool     `json:"browser_session_allow_remembered"`
}

type publicConfigTransportHintsDTO struct {
	ReconnectBackoffMinMS int  `json:"reconnect_backoff_min_ms"`
	ReconnectBackoffMaxMS int  `json:"reconnect_backoff_max_ms"`
	LongPollTimeoutSec    int  `json:"long_poll_timeout_sec"`
	LongPollEnabled       bool `json:"long_poll_enabled"`
}

func buildEnvelopeResponse(envelope *auth.SessionEnvelope, recoveryCodes []string) envelopeResponse {
	return envelopeResponse{
		AccountID:     envelope.Account.ID,
		Identity:      mapIdentity(envelope.Identity),
		Device:        mapDevice(envelope.Device),
		Session:       mapSession(envelope.Session, envelope.Device),
		Tokens:        mapTokens(envelope.Tokens),
		RecoveryCodes: recoveryCodes,
	}
}

func mapIdentity(identity domain.AccountIdentity) identityDTO {
	_, safety := fingerprintPair(identity.Fingerprint)
	return identityDTO{
		AccountID:              identity.AccountID,
		PublicIdentityMaterial: identity.PublicIdentityMaterial,
		Fingerprint: fingerprintDTO{
			Algorithm:    "sha256",
			Value:        identity.Fingerprint,
			SafetyNumber: safety,
		},
		VerificationState: string(identity.VerificationState),
		TrustState:        identity.TrustState,
		CreatedAt:         identity.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:         identity.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func mapDevice(device domain.Device) deviceDTO {
	_, safety := fingerprintPair(device.Fingerprint)
	rotationRecommended := false
	if device.RotationDueAt != nil && time.Now().UTC().After(device.RotationDueAt.UTC()) {
		rotationRecommended = true
	}
	return deviceDTO{
		ID:                   device.ID,
		AccountID:            device.AccountID,
		Name:                 device.Name,
		Platform:             device.Platform,
		PublicDeviceMaterial: device.PublicDeviceMaterial,
		Fingerprint: fingerprintDTO{
			Algorithm:    "sha256",
			Value:        device.Fingerprint,
			SafetyNumber: safety,
		},
		Status:            string(device.Status),
		VerificationState: string(device.VerificationState),
		KeyInfo: deviceKeyInfoDTO{
			Version:             max(device.KeyVersion, 1),
			RotatedAt:           formatNullableTime(device.RotatedAt),
			RotationDueAt:       formatNullableTime(device.RotationDueAt),
			RotationRecommended: rotationRecommended,
		},
		CreatedAt:  device.CreatedAt.UTC().Format(time.RFC3339),
		LastSeenAt: formatNullableTime(device.LastSeenAt),
		RevokedAt:  formatNullableTime(device.RevokedAt),
	}
}

func mapSession(session domain.Session, device domain.Device) sessionDTO {
	trustWarnings := make([]string, 0, 2)
	if device.Status != domain.DeviceStatusTrusted {
		trustWarnings = append(trustWarnings, "device_not_trusted")
	}
	if device.RotationDueAt != nil && time.Now().UTC().After(device.RotationDueAt.UTC()) {
		trustWarnings = append(trustWarnings, "device_key_rotation_due")
	}
	return sessionDTO{
		ID:                    session.ID,
		AccountID:             session.AccountID,
		DeviceID:              session.DeviceID,
		Status:                string(session.Status),
		ClientPlatform:        string(session.ClientPlatform),
		SessionClass:          string(session.SessionClass),
		Persistent:            session.Persistent,
		AccessTokenExpiresAt:  session.AccessTokenExpiresAt.UTC().Format(time.RFC3339),
		RefreshTokenExpiresAt: session.RefreshTokenExpiresAt.UTC().Format(time.RFC3339),
		CreatedAt:             session.CreatedAt.UTC().Format(time.RFC3339),
		LastSeenAt:            formatNullableTime(session.LastSeenAt),
		TrustWarnings:         trustWarnings,
	}
}

func mapTokens(tokens auth.TokenPair) tokensDTO {
	return tokensDTO{
		AccessToken:      tokens.AccessToken,
		RefreshToken:     tokens.RefreshToken,
		TokenType:        "Bearer",
		ExpiresInSeconds: int64(time.Until(tokens.AccessTokenExpiresAt).Seconds()),
	}
}

func mapApproval(req domain.DeviceApprovalRequest) approvalDTO {
	return approvalDTO{
		ID:         req.ID,
		AccountID:  req.AccountID,
		DeviceID:   req.DeviceID,
		Status:     string(req.Status),
		CreatedAt:  req.CreatedAt.UTC().Format(time.RFC3339),
		ResolvedAt: formatNullableTime(req.ResolvedAt),
	}
}

func mapSecurityEvent(event domain.SecurityEvent) securityEventDTO {
	return securityEventDTO{
		ID:         event.ID,
		AccountID:  event.AccountID,
		DeviceID:   event.DeviceID,
		EventType:  string(event.EventType),
		Severity:   string(event.Severity),
		TrustState: event.TrustState,
		Metadata:   event.Metadata,
		CreatedAt:  event.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func formatNullableTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func mapConversation(payload messaging.ConversationWithMembers) conversationDTO {
	members := make([]conversationMemberDTO, 0, len(payload.Members))
	for _, member := range payload.Members {
		devices := make([]deviceDTO, 0, len(member.TrustedDevices))
		for _, device := range member.TrustedDevices {
			devices = append(devices, mapDevice(device))
		}
		members = append(members, conversationMemberDTO{
			AccountID:      member.Member.AccountID,
			Role:           string(member.Member.Role),
			JoinedAt:       member.Member.JoinedAt.UTC().Format(time.RFC3339),
			IsActive:       member.Member.IsActive,
			TrustedDevices: devices,
		})
	}

	return conversationDTO{
		ID:                 payload.Conversation.ID,
		Type:               string(payload.Conversation.Type),
		Title:              payload.Conversation.Title,
		CreatedByAccountID: payload.Conversation.CreatedByAccountID,
		CreatedAt:          payload.Conversation.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          payload.Conversation.UpdatedAt.UTC().Format(time.RFC3339),
		DisappearingPolicy: disappearingPolicyDTO{
			DefaultTTLSeconds:       payload.Conversation.DefaultTTLSeconds,
			AllowPerMessageOverride: payload.Conversation.AllowTTLOverride,
		},
		Members:            members,
		LastServerSequence: payload.Conversation.LastServerSequence,
	}
}

func mapMessage(payload messaging.MessageView) messageDTO {
	recipientState := string(domain.DeliveryStateSent)
	deliveredAt := (*string)(nil)
	failedReason := (*string)(nil)
	recipients := make([]recipientKeyDTO, 0)
	if payload.Recipient != nil {
		recipientState = string(payload.Recipient.DeliveryState)
		deliveredAt = formatNullableTime(payload.Recipient.DeliveredAt)
		failedReason = payload.Recipient.FailedReason
		recipients = append(recipients, recipientKeyDTO{
			RecipientDeviceID: payload.Recipient.RecipientDeviceID,
			WrappedKey:        payload.Recipient.WrappedKey,
			KeyAlgorithm:      payload.Recipient.KeyAlgorithm,
		})
	}

	attachments := make([]attachmentMetaDTO, 0, len(payload.Attachments))
	for _, attachment := range payload.Attachments {
		attachments = append(attachments, mapAttachmentMeta(attachment))
	}

	receipts := make([]messageReceiptDTO, 0, len(payload.Receipts))
	for _, receipt := range payload.Receipts {
		receipts = append(receipts, messageReceiptDTO{
			ID:          receipt.ID,
			MessageID:   receipt.MessageID,
			DeviceID:    receipt.DeviceID,
			ReceiptType: string(receipt.ReceiptType),
			CreatedAt:   receipt.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	return messageDTO{
		Envelope: encryptedEnvelopeDTO{
			ID:               payload.Envelope.ID,
			ConversationID:   payload.Envelope.ConversationID,
			SenderAccountID:  payload.Envelope.SenderAccountID,
			SenderDeviceID:   payload.Envelope.SenderDeviceID,
			ClientMessageID:  payload.Envelope.ClientMessageID,
			Algorithm:        payload.Envelope.Algorithm,
			CryptoVersion:    payload.Envelope.CryptoVersion,
			Nonce:            payload.Envelope.Nonce,
			Ciphertext:       payload.Envelope.Ciphertext,
			Recipients:       recipients,
			Attachments:      attachments,
			ReplyToMessageID: payload.Envelope.ReplyToMessageID,
			TTLSeconds:       payload.Envelope.TTLSeconds,
			CreatedAt:        payload.Envelope.CreatedAt.UTC().Format(time.RFC3339),
			ExpiresAt:        formatNullableTime(payload.Envelope.ExpiresAt),
			ServerSequence:   payload.Envelope.ServerSequence,
		},
		DeliveryState: recipientState,
		DeliveredAt:   deliveredAt,
		FailedReason:  failedReason,
		Receipts:      receipts,
	}
}

func mapAttachmentMeta(attachment domain.AttachmentObject) attachmentMetaDTO {
	dto := attachmentMetaDTO{
		ID:             attachment.ID,
		Kind:           string(attachment.Kind),
		FileName:       attachment.FileName,
		MimeType:       attachment.MimeType,
		SizeBytes:      attachment.SizeBytes,
		ChecksumSHA256: attachment.ChecksumSHA256,
		CreatedAt:      attachment.CreatedAt.UTC().Format(time.RFC3339),
	}
	dto.Encryption.Algorithm = attachment.Algorithm
	dto.Encryption.Nonce = attachment.Nonce
	return dto
}

func fingerprintPair(fingerprint string) (string, string) {
	safety := fingerprint
	if len(safety) > 60 {
		safety = safety[:60]
	}
	for len(safety) < 60 {
		safety += "0"
	}
	safety = safety[:12] + "-" + safety[12:24] + "-" + safety[24:36] + "-" + safety[36:48] + "-" + safety[48:60]
	return fingerprint, safety
}
