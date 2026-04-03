package messaging

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/validation"
)

const (
	defaultSyncLimit           = 100
	maxMessageRecipients       = 256
	maxCiphertextLength        = 2_000_000
	maxWrappedKeyLength        = 8_192
	maxNonceLength             = 4_096
	maxWrappedKeyBytes         = 2_048
	maxMessageBytes            = 1_500_000
	expectedNonceBytes         = 24
	allowedMessageAlgorithm    = "xchacha20poly1305_ietf+sealedbox"
	allowedKeyWrapAlgorithm    = "x25519-sealedbox"
	allowedAttachmentAlgorithm = "xchacha20poly1305_ietf"
)

type PushNotifier interface {
	NotifyDeviceSync(deviceID string, cursor int64)
}

type Service struct {
	cfg      config.Config
	repo     *postgres.Store
	events   *securityevents.Service
	notifier PushNotifier
	logger   *slog.Logger
}

func New(cfg config.Config, repo *postgres.Store, events *securityevents.Service, logger *slog.Logger) *Service {
	return &Service{
		cfg:    cfg,
		repo:   repo,
		events: events,
		logger: logger,
	}
}

func (s *Service) SetNotifier(notifier PushNotifier) {
	s.notifier = notifier
}

type ConversationWithMembers struct {
	Conversation domain.Conversation
	Members      []ConversationMemberWithDevices
}

type ConversationMemberWithDevices struct {
	Member         domain.ConversationMember
	TrustedDevices []domain.Device
}

type RecipientInput struct {
	RecipientDeviceID string
	WrappedKey        string
	KeyAlgorithm      string
}

type SendMessageInput struct {
	Principal        auth.AuthPrincipal
	ConversationID   string
	ClientMessageID  string
	Algorithm        string
	CryptoVersion    int
	Nonce            string
	Ciphertext       string
	Recipients       []RecipientInput
	AttachmentIDs    []string
	ReplyToMessageID *string
	TTLSeconds       *int
}

type MessageView struct {
	Envelope    domain.MessageEnvelope
	Recipient   *domain.MessageRecipient
	Receipts    []domain.MessageReceipt
	Attachments []domain.AttachmentObject
}

type AttachmentUploadInput struct {
	Principal      auth.AuthPrincipal
	Kind           domain.AttachmentKind
	FileName       string
	MimeType       string
	SizeBytes      int64
	ChecksumSHA256 string
	Algorithm      string
	Nonce          string
	CiphertextB64  string
}

type AttachmentDownloadResult struct {
	Attachment    domain.AttachmentObject
	CiphertextB64 string
}

type SyncBatch struct {
	CursorID   string
	FromCursor int64
	ToCursor   int64
	Messages   []MessageView
	HasMore    bool
}

type TransportProfile struct {
	Name                  string
	ReconnectBackoffMinMS int
	ReconnectBackoffMaxMS int
	LongPollTimeoutSec    int
	LongPollEnabled       bool
}

func (s *Service) CreateDirectConversation(ctx context.Context, principal auth.AuthPrincipal, peerAccountID string, defaultTTLSeconds int) (ConversationWithMembers, error) {
	if strings.TrimSpace(peerAccountID) == "" {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeValidation, "peer account id is required")
	}
	if peerAccountID == principal.AccountID {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeValidation, "cannot create direct conversation with self")
	}
	if _, err := s.repo.GetAccountByID(ctx, peerAccountID); err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeNotFound, "peer account not found")
	}

	existing, err := s.repo.FindDirectConversationByPair(ctx, principal.AccountID, peerAccountID)
	if err == nil {
		return s.loadConversationWithMembers(ctx, existing.ID)
	}
	if err != nil && err != postgres.ErrNotFound {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to lookup direct conversation")
	}

	now := time.Now().UTC()
	conversationID := security.NewID()
	conversation := domain.Conversation{
		ID:                 conversationID,
		Type:               domain.ConversationTypeDirect,
		CreatedByAccountID: principal.AccountID,
		DefaultTTLSeconds:  max(defaultTTLSeconds, 0),
		AllowTTLOverride:   true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	members := []domain.ConversationMember{
		{
			ConversationID: conversationID,
			AccountID:      principal.AccountID,
			Role:           domain.ConversationRoleMember,
			JoinedAt:       now,
			IsActive:       true,
		},
		{
			ConversationID: conversationID,
			AccountID:      peerAccountID,
			Role:           domain.ConversationRoleMember,
			JoinedAt:       now,
			IsActive:       true,
		},
	}

	created, createErr := s.repo.CreateDirectConversation(ctx, conversation, members[0], members[1])
	if createErr != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to create direct conversation")
	}

	return s.loadConversationWithMembers(ctx, created.ID)
}

func (s *Service) CreateGroupConversation(ctx context.Context, principal auth.AuthPrincipal, title string, memberAccountIDs []string, defaultTTLSeconds int) (ConversationWithMembers, error) {
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeValidation, "title is required")
	}

	seen := map[string]struct{}{
		principal.AccountID: {},
	}
	normalizedMembers := make([]string, 0, len(memberAccountIDs))
	for _, memberID := range memberAccountIDs {
		memberID = strings.TrimSpace(memberID)
		if memberID == "" {
			continue
		}
		if _, exists := seen[memberID]; exists {
			continue
		}
		if _, err := s.repo.GetAccountByID(ctx, memberID); err != nil {
			return ConversationWithMembers{}, service.NewErrorWithDetails(service.ErrorCodeValidation, "member account not found", map[string]any{"accountId": memberID})
		}
		seen[memberID] = struct{}{}
		normalizedMembers = append(normalizedMembers, memberID)
	}

	now := time.Now().UTC()
	conversationID := security.NewID()
	titleCopy := trimmedTitle
	conversation := domain.Conversation{
		ID:                 conversationID,
		Type:               domain.ConversationTypeGroup,
		Title:              &titleCopy,
		CreatedByAccountID: principal.AccountID,
		DefaultTTLSeconds:  max(defaultTTLSeconds, 0),
		AllowTTLOverride:   true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	members := []domain.ConversationMember{
		{
			ConversationID: conversationID,
			AccountID:      principal.AccountID,
			Role:           domain.ConversationRoleOwner,
			JoinedAt:       now,
			IsActive:       true,
		},
	}
	for _, memberID := range normalizedMembers {
		members = append(members, domain.ConversationMember{
			ConversationID: conversationID,
			AccountID:      memberID,
			Role:           domain.ConversationRoleMember,
			JoinedAt:       now,
			IsActive:       true,
		})
	}

	created, err := s.repo.CreateGroupConversation(ctx, conversation, members)
	if err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to create group conversation")
	}

	return s.loadConversationWithMembers(ctx, created.ID)
}

func (s *Service) ListConversations(ctx context.Context, principal auth.AuthPrincipal) ([]ConversationWithMembers, error) {
	conversations, err := s.repo.ListConversationsByAccount(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list conversations")
	}

	result := make([]ConversationWithMembers, 0, len(conversations))
	for _, conversation := range conversations {
		item, loadErr := s.loadConversationWithMembers(ctx, conversation.ID)
		if loadErr != nil {
			return nil, loadErr
		}
		result = append(result, item)
	}

	return result, nil
}

func (s *Service) GetConversation(ctx context.Context, principal auth.AuthPrincipal, conversationID string) (ConversationWithMembers, error) {
	conversation, err := s.loadConversationWithMembers(ctx, conversationID)
	if err != nil {
		return ConversationWithMembers{}, err
	}
	if !hasActiveMember(conversation.Members, principal.AccountID) {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeMembershipDenied, "membership denied")
	}
	return conversation, nil
}

func (s *Service) AddMember(ctx context.Context, principal auth.AuthPrincipal, conversationID string, memberAccountID string, role domain.ConversationRole) (ConversationWithMembers, error) {
	conversation, err := s.loadConversationWithMembers(ctx, conversationID)
	if err != nil {
		return ConversationWithMembers{}, err
	}
	if conversation.Conversation.Type != domain.ConversationTypeGroup {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeValidation, "members can be changed only in group conversations")
	}

	currentMember, ok := findMember(conversation.Members, principal.AccountID)
	if !ok || !currentMember.Member.IsActive {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeMembershipDenied, "membership denied")
	}
	if currentMember.Member.Role != domain.ConversationRoleOwner && currentMember.Member.Role != domain.ConversationRoleAdmin {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeForbidden, "insufficient member role")
	}

	if _, err := s.repo.GetAccountByID(ctx, memberAccountID); err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeNotFound, "member account not found")
	}

	if role == "" {
		role = domain.ConversationRoleMember
	}

	if err := s.repo.AddConversationMember(ctx, domain.ConversationMember{
		ConversationID: conversationID,
		AccountID:      memberAccountID,
		Role:           role,
		IsActive:       true,
		JoinedAt:       time.Now().UTC(),
	}); err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to add conversation member")
	}

	return s.loadConversationWithMembers(ctx, conversationID)
}

func (s *Service) SendMessage(ctx context.Context, input SendMessageInput) (MessageView, error) {
	if strings.TrimSpace(input.ClientMessageID) == "" {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "clientMessageId is required")
	}
	if strings.TrimSpace(input.Algorithm) != allowedMessageAlgorithm {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "unsupported message algorithm")
	}
	if input.CryptoVersion <= 0 {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "cryptoVersion must be positive")
	}
	if input.CryptoVersion != 1 {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "unsupported cryptoVersion")
	}
	if strings.TrimSpace(input.Nonce) == "" || strings.TrimSpace(input.Ciphertext) == "" {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "nonce and ciphertext are required")
	}
	if len(input.Ciphertext) > maxCiphertextLength {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "ciphertext is too large")
	}
	if len(input.Nonce) > maxNonceLength {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "nonce is too large")
	}
	nonceBytes, decodeNonceErr := base64.StdEncoding.DecodeString(strings.TrimSpace(input.Nonce))
	if decodeNonceErr != nil || len(nonceBytes) != expectedNonceBytes {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "invalid message nonce")
	}
	ciphertextBytes, decodeCiphertextErr := base64.StdEncoding.DecodeString(strings.TrimSpace(input.Ciphertext))
	if decodeCiphertextErr != nil {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "invalid ciphertext encoding")
	}
	if len(ciphertextBytes) == 0 || len(ciphertextBytes) > maxMessageBytes {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "ciphertext size is invalid")
	}
	if len(input.Recipients) == 0 {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "at least one recipient is required")
	}
	if len(input.Recipients) > maxMessageRecipients {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "too many recipients")
	}

	conversationWithMembers, err := s.loadConversationWithMembers(ctx, input.ConversationID)
	if err != nil {
		return MessageView{}, err
	}
	if !hasActiveMember(conversationWithMembers.Members, input.Principal.AccountID) {
		return MessageView{}, service.NewError(service.ErrorCodeMembershipDenied, "membership denied")
	}

	if existing, lookupErr := s.repo.GetMessageBySenderClientID(ctx, input.Principal.DeviceID, input.ClientMessageID); lookupErr == nil {
		view, viewErr := s.loadMessageViewByID(ctx, input.Principal.DeviceID, existing.ID)
		if viewErr != nil {
			return MessageView{Envelope: existing}, nil
		}
		return view, nil
	} else if lookupErr != postgres.ErrNotFound {
		return MessageView{}, service.NewError(service.ErrorCodeInternal, "failed to resolve idempotent message")
	}

	allowedDevices := make(map[string]string)
	for _, member := range conversationWithMembers.Members {
		if !member.Member.IsActive {
			continue
		}
		for _, device := range member.TrustedDevices {
			allowedDevices[device.ID] = device.AccountID
		}
	}

	seenRecipients := make(map[string]struct{})
	recipients := make([]domain.MessageRecipient, 0, len(input.Recipients))
	for _, recipient := range input.Recipients {
		deviceID := strings.TrimSpace(recipient.RecipientDeviceID)
		if deviceID == "" {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient device id is required")
		}
		if _, exists := seenRecipients[deviceID]; exists {
			continue
		}
		accountID, allowed := allowedDevices[deviceID]
		if !allowed {
			return MessageView{}, service.NewErrorWithDetails(service.ErrorCodeMembershipDenied, "recipient device is not eligible", map[string]any{"recipientDeviceId": deviceID})
		}
		if strings.TrimSpace(recipient.WrappedKey) == "" || strings.TrimSpace(recipient.KeyAlgorithm) == "" {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient wrapped key is required")
		}
		if len(recipient.WrappedKey) > maxWrappedKeyLength {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient wrapped key is too large")
		}
		if strings.TrimSpace(recipient.KeyAlgorithm) != allowedKeyWrapAlgorithm {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient key algorithm is invalid")
		}
		wrappedKeyBytes, decodeWrappedErr := base64.StdEncoding.DecodeString(strings.TrimSpace(recipient.WrappedKey))
		if decodeWrappedErr != nil {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient wrapped key encoding is invalid")
		}
		if len(wrappedKeyBytes) == 0 || len(wrappedKeyBytes) > maxWrappedKeyBytes {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "recipient wrapped key size is invalid")
		}
		seenRecipients[deviceID] = struct{}{}
		recipients = append(recipients, domain.MessageRecipient{
			MessageID:          "",
			RecipientAccountID: accountID,
			RecipientDeviceID:  deviceID,
			WrappedKey:         recipient.WrappedKey,
			KeyAlgorithm:       recipient.KeyAlgorithm,
			DeliveryState:      domain.DeliveryStateQueued,
			QueuedAt:           time.Now().UTC(),
		})
	}

	if len(recipients) == 0 {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "no valid recipients provided")
	}
	if _, ok := seenRecipients[input.Principal.DeviceID]; !ok {
		return MessageView{}, service.NewError(service.ErrorCodeValidation, "sender device recipient is required")
	}

	var ttlSeconds *int
	if input.TTLSeconds != nil {
		if *input.TTLSeconds < 0 {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "ttlSeconds must be positive")
		}
		if !conversationWithMembers.Conversation.AllowTTLOverride {
			return MessageView{}, service.NewError(service.ErrorCodeValidation, "ttl override is not allowed by conversation policy")
		}
		ttl := *input.TTLSeconds
		ttlSeconds = &ttl
	} else if conversationWithMembers.Conversation.DefaultTTLSeconds > 0 {
		ttl := conversationWithMembers.Conversation.DefaultTTLSeconds
		ttlSeconds = &ttl
	}

	var expiresAt *time.Time
	if ttlSeconds != nil && *ttlSeconds > 0 {
		expiry := time.Now().UTC().Add(time.Duration(*ttlSeconds) * time.Second)
		expiresAt = &expiry
	}

	messageID := security.NewID()
	message := domain.MessageEnvelope{
		ID:               messageID,
		ConversationID:   input.ConversationID,
		SenderAccountID:  input.Principal.AccountID,
		SenderDeviceID:   input.Principal.DeviceID,
		ClientMessageID:  input.ClientMessageID,
		Algorithm:        input.Algorithm,
		CryptoVersion:    input.CryptoVersion,
		Nonce:            input.Nonce,
		Ciphertext:       input.Ciphertext,
		ReplyToMessageID: input.ReplyToMessageID,
		TTLSeconds:       ttlSeconds,
		ExpiresAt:        expiresAt,
		CreatedAt:        time.Now().UTC(),
	}

	for idx := range recipients {
		recipients[idx].MessageID = messageID
	}

	createdMessage, err := s.repo.InsertMessageWithRecipients(ctx, message, recipients, input.AttachmentIDs)
	if err != nil {
		return MessageView{}, service.NewError(service.ErrorCodeInternal, "failed to send message")
	}
	s.logger.Info("message accepted for relay",
		"conversation_id", createdMessage.ConversationID,
		"message_id", createdMessage.ID,
		"server_sequence", createdMessage.ServerSequence,
		"recipient_devices", len(recipients),
	)

	for _, recipient := range recipients {
		if recipient.RecipientDeviceID == input.Principal.DeviceID {
			if markErr := s.repo.MarkMessageDelivered(ctx, createdMessage.ID, recipient.RecipientDeviceID); markErr != nil {
				s.logger.Warn("failed to mark sender device message as delivered", "message_id", createdMessage.ID, "device_id", recipient.RecipientDeviceID, "error", markErr)
			}
		}
	}

	messageView, err := s.loadMessageViewByID(ctx, input.Principal.DeviceID, createdMessage.ID)
	if err != nil {
		return MessageView{}, err
	}

	for _, recipient := range recipients {
		if s.notifier != nil {
			s.notifier.NotifyDeviceSync(recipient.RecipientDeviceID, createdMessage.ServerSequence)
		}
	}

	deviceID := input.Principal.DeviceID
	s.events.Record(ctx, input.Principal.AccountID, &deviceID, domain.SecurityEventMessageSent, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"conversationId": createdMessage.ConversationID,
		"messageId":      createdMessage.ID,
		"recipientCount": len(recipients),
	})

	return messageView, nil
}

func (s *Service) ListConversationMessages(ctx context.Context, principal auth.AuthPrincipal, conversationID string, limit int, beforeSequence int64) ([]MessageView, error) {
	conversation, err := s.loadConversationWithMembers(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	if !hasActiveMember(conversation.Members, principal.AccountID) {
		return nil, service.NewError(service.ErrorCodeMembershipDenied, "membership denied")
	}

	rows, err := s.repo.ListConversationMessagesForDevice(ctx, conversationID, principal.DeviceID, limit, beforeSequence)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list conversation messages")
	}
	for index := range rows {
		if rows[index].Recipient == nil || rows[index].Recipient.DeliveryState == domain.DeliveryStateDelivered {
			continue
		}
		deliveredAt := time.Now().UTC()
		if markErr := s.repo.MarkMessageDelivered(ctx, rows[index].Envelope.ID, principal.DeviceID); markErr != nil {
			s.logger.Warn("failed to mark listed message delivered", "message_id", rows[index].Envelope.ID, "device_id", principal.DeviceID, "error", markErr)
			continue
		}
		rows[index].Recipient.DeliveryState = domain.DeliveryStateDelivered
		rows[index].Recipient.DeliveredAt = &deliveredAt
	}
	return s.hydrateMessageRows(ctx, rows)
}

func (s *Service) CreateReceipt(ctx context.Context, principal auth.AuthPrincipal, messageID string, receiptType domain.ReceiptType) (domain.MessageReceipt, error) {
	if receiptType != domain.ReceiptTypeDelivered && receiptType != domain.ReceiptTypeRead {
		return domain.MessageReceipt{}, service.NewError(service.ErrorCodeValidation, "invalid receipt type")
	}

	message, err := s.repo.GetMessageByID(ctx, messageID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.MessageReceipt{}, service.NewError(service.ErrorCodeNotFound, "message not found")
		}
		return domain.MessageReceipt{}, service.NewError(service.ErrorCodeInternal, "failed to load message")
	}

	member, err := s.repo.GetConversationMember(ctx, message.ConversationID, principal.AccountID)
	if err != nil || !member.IsActive {
		return domain.MessageReceipt{}, service.NewError(service.ErrorCodeMembershipDenied, "membership denied")
	}

	receipt, err := s.repo.CreateMessageReceipt(ctx, domain.MessageReceipt{
		ID:          security.NewID(),
		MessageID:   messageID,
		DeviceID:    principal.DeviceID,
		ReceiptType: receiptType,
		CreatedAt:   time.Now().UTC(),
	})
	if err != nil {
		return domain.MessageReceipt{}, service.NewError(service.ErrorCodeInternal, "failed to create receipt")
	}
	return receipt, nil
}

func (s *Service) SyncBootstrap(ctx context.Context, principal auth.AuthPrincipal, limit int) (SyncBatch, error) {
	cursor, err := s.getOrCreateCursor(ctx, principal.DeviceID)
	if err != nil {
		return SyncBatch{}, err
	}
	return s.syncFromCursor(ctx, principal, cursor.LastCursor, limit, cursor.CursorID)
}

func (s *Service) SyncPoll(ctx context.Context, principal auth.AuthPrincipal, requestedCursor int64, timeout time.Duration, limit int) (SyncBatch, error) {
	cursor, err := s.getOrCreateCursor(ctx, principal.DeviceID)
	if err != nil {
		return SyncBatch{}, err
	}
	fromCursor := max(cursor.LastCursor, requestedCursor)
	if fromCursor < 0 {
		fromCursor = 0
	}
	deadline := time.Now().Add(timeout)

	for {
		batch, syncErr := s.syncFromCursor(ctx, principal, fromCursor, limit, cursor.CursorID)
		if syncErr != nil {
			return SyncBatch{}, syncErr
		}
		if len(batch.Messages) > 0 || time.Now().After(deadline) {
			return batch, nil
		}

		select {
		case <-ctx.Done():
			return SyncBatch{}, service.NewError(service.ErrorCodeTransportUnavailable, "sync poll cancelled")
		case <-time.After(700 * time.Millisecond):
		}
	}
}

func (s *Service) UploadAttachment(ctx context.Context, input AttachmentUploadInput) (domain.AttachmentObject, error) {
	if input.Kind != domain.AttachmentKindImage && input.Kind != domain.AttachmentKindFile {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeValidation, "unsupported attachment kind")
	}
	if input.SizeBytes <= 0 {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeValidation, "attachment size must be positive")
	}
	if input.SizeBytes > s.cfg.Messaging.AttachmentMaxSizeBytes {
		return domain.AttachmentObject{}, service.NewErrorWithDetails(service.ErrorCodeAttachmentUploadFailed, "attachment exceeds max size", map[string]any{"maxBytes": s.cfg.Messaging.AttachmentMaxSizeBytes})
	}
	if err := validation.MimeType(input.MimeType); err != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment mime type is not allowed")
	}
	if err := validation.FileName(input.FileName); err != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment file name is invalid")
	}
	if strings.TrimSpace(input.Algorithm) != allowedAttachmentAlgorithm {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment encryption algorithm is invalid")
	}
	if len(strings.TrimSpace(input.Nonce)) == 0 || len(strings.TrimSpace(input.Nonce)) > maxNonceLength {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment nonce is invalid")
	}
	attachmentNonce, nonceErr := base64.StdEncoding.DecodeString(strings.TrimSpace(input.Nonce))
	if nonceErr != nil || len(attachmentNonce) != expectedNonceBytes {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment nonce is invalid")
	}

	decoded, err := base64.StdEncoding.DecodeString(input.CiphertextB64)
	if err != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "invalid attachment ciphertext payload")
	}
	if int64(len(decoded)) != input.SizeBytes {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment size mismatch")
	}
	checksum := strings.TrimSpace(strings.ToLower(input.ChecksumSHA256))
	decodedChecksum := sha256.Sum256(decoded)
	if hex.EncodeToString(decodedChecksum[:]) != checksum {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "attachment checksum mismatch")
	}

	attachmentRoot, rootErr := filepath.Abs(s.cfg.Messaging.AttachmentsDir)
	if rootErr != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "failed to resolve attachment directory")
	}
	if err := os.MkdirAll(attachmentRoot, 0o700); err != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "failed to prepare attachment directory")
	}

	attachmentID := security.NewID()
	storagePath := filepath.Join(attachmentRoot, attachmentID+".blob")
	if !isPathInsideBase(storagePath, attachmentRoot) {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "resolved attachment path is invalid")
	}
	if writeErr := os.WriteFile(storagePath, decoded, 0o600); writeErr != nil {
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "failed to persist attachment payload")
	}

	expiresAt := time.Now().UTC().Add(s.cfg.Messaging.UnattachedRetention)
	attachment, createErr := s.repo.CreateAttachmentObject(ctx, domain.AttachmentObject{
		ID:             attachmentID,
		AccountID:      input.Principal.AccountID,
		Kind:           input.Kind,
		FileName:       strings.TrimSpace(input.FileName),
		MimeType:       strings.TrimSpace(input.MimeType),
		SizeBytes:      input.SizeBytes,
		ChecksumSHA256: checksum,
		Algorithm:      strings.TrimSpace(input.Algorithm),
		Nonce:          strings.TrimSpace(input.Nonce),
		StoragePath:    storagePath,
		CreatedAt:      time.Now().UTC(),
		ExpiresAt:      &expiresAt,
	})
	if createErr != nil {
		_ = os.Remove(storagePath)
		return domain.AttachmentObject{}, service.NewError(service.ErrorCodeAttachmentUploadFailed, "failed to store attachment metadata")
	}
	s.logger.Info("encrypted attachment uploaded",
		"attachment_id", attachment.ID,
		"account_id", attachment.AccountID,
		"size_bytes", attachment.SizeBytes,
		"mime_type", attachment.MimeType,
	)

	deviceID := input.Principal.DeviceID
	s.events.Record(ctx, input.Principal.AccountID, &deviceID, domain.SecurityEventAttachmentUploaded, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"attachmentId": attachment.ID,
		"mimeType":     attachment.MimeType,
		"sizeBytes":    attachment.SizeBytes,
	})

	if cleanupErr := s.cleanupExpiredUnattached(ctx); cleanupErr != nil {
		s.logger.Warn("attachment cleanup iteration failed", "error", cleanupErr)
	}

	return attachment, nil
}

func (s *Service) DownloadAttachment(ctx context.Context, principal auth.AuthPrincipal, attachmentID string) (AttachmentDownloadResult, error) {
	attachment, err := s.repo.GetAttachmentObjectByID(ctx, attachmentID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeNotFound, "attachment not found")
		}
		return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeAttachmentDownloadFailed, "failed to fetch attachment")
	}

	authorized := attachment.AccountID == principal.AccountID
	if !authorized && attachment.MessageID != nil {
		message, messageErr := s.repo.GetMessageByID(ctx, *attachment.MessageID)
		if messageErr == nil {
			member, memberErr := s.repo.GetConversationMember(ctx, message.ConversationID, principal.AccountID)
			if memberErr == nil && member.IsActive {
				authorized = true
			}
		}
	}
	if !authorized {
		return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeForbidden, "attachment access denied")
	}

	attachmentPath, pathErr := s.resolveAttachmentPath(attachment.StoragePath)
	if pathErr != nil {
		return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeAttachmentDownloadFailed, "attachment path is invalid")
	}

	data, readErr := os.ReadFile(attachmentPath)
	if readErr != nil {
		return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeAttachmentDownloadFailed, "failed to read attachment payload")
	}
	checksum := sha256.Sum256(data)
	if hex.EncodeToString(checksum[:]) != strings.ToLower(strings.TrimSpace(attachment.ChecksumSHA256)) {
		return AttachmentDownloadResult{}, service.NewError(service.ErrorCodeAttachmentDownloadFailed, "attachment checksum mismatch")
	}

	deviceID := principal.DeviceID
	s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventAttachmentDownloaded, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"attachmentId": attachment.ID,
	})

	return AttachmentDownloadResult{
		Attachment:    attachment,
		CiphertextB64: base64.StdEncoding.EncodeToString(data),
	}, nil
}

func (s *Service) ListTransportEndpoints() (TransportProfile, []domain.TransportEndpoint) {
	profile := TransportProfile{
		Name:                  "default",
		ReconnectBackoffMinMS: int(s.cfg.Transport.ReconnectBackoffMin.Milliseconds()),
		ReconnectBackoffMaxMS: int(s.cfg.Transport.ReconnectBackoffMax.Milliseconds()),
		LongPollTimeoutSec:    int(s.cfg.Transport.LongPollTimeout.Seconds()),
		LongPollEnabled:       s.cfg.Transport.LongPollEnabled,
	}

	endpoints := make([]domain.TransportEndpoint, 0)
	primaryWS := s.cfg.Transport.PrimaryWebSocketEndpoint
	if strings.TrimSpace(primaryWS) == "" {
		primaryWS = fmt.Sprintf("ws://localhost:%d%s", s.cfg.HTTP.Port, s.cfg.HTTP.WebSocketPath)
	}
	endpoints = append(endpoints, domain.TransportEndpoint{
		ID:       "primary-ws",
		URL:      primaryWS,
		Mode:     domain.TransportModeWebSocket,
		Priority: 0,
		Enabled:  true,
	})
	for index, endpoint := range s.cfg.Transport.AlternateEndpoints {
		if strings.TrimSpace(endpoint) == "" {
			continue
		}
		mode := domain.TransportModeWebSocket
		if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
			mode = domain.TransportModeLongPoll
		}
		enabled := true
		if mode == domain.TransportModeLongPoll && !profile.LongPollEnabled {
			enabled = false
		}
		endpoints = append(endpoints, domain.TransportEndpoint{
			ID:       fmt.Sprintf("alt-%d", index+1),
			URL:      endpoint,
			Mode:     mode,
			Priority: index + 1,
			Enabled:  enabled,
		})
	}

	slices.SortFunc(endpoints, func(left domain.TransportEndpoint, right domain.TransportEndpoint) int {
		return left.Priority - right.Priority
	})
	return profile, endpoints
}

func (s *Service) syncFromCursor(ctx context.Context, principal auth.AuthPrincipal, fromCursor int64, limit int, cursorID string) (SyncBatch, error) {
	if limit <= 0 || limit > 200 {
		limit = defaultSyncLimit
	}
	if fromCursor < 0 {
		fromCursor = 0
	}

	rows, err := s.repo.ListDeliverableMessagesSince(ctx, principal.DeviceID, fromCursor, limit)
	if err != nil {
		return SyncBatch{}, service.NewError(service.ErrorCodeInternal, "failed to fetch sync messages")
	}
	s.logger.Debug("sync query completed", "device_id", principal.DeviceID, "from_cursor", fromCursor, "items", len(rows))
	messages, err := s.hydrateMessageRows(ctx, rows)
	if err != nil {
		return SyncBatch{}, err
	}

	toCursor := fromCursor
	for index, message := range messages {
		if message.Envelope.ServerSequence > toCursor {
			toCursor = message.Envelope.ServerSequence
		}
		if message.Recipient != nil && message.Recipient.DeliveryState != domain.DeliveryStateDelivered {
			deliveredAt := time.Now().UTC()
			if markErr := s.repo.MarkMessageDelivered(ctx, message.Envelope.ID, principal.DeviceID); markErr != nil {
				s.logger.Warn("failed to mark sync message delivered", "message_id", message.Envelope.ID, "device_id", principal.DeviceID, "error", markErr)
				continue
			}
			message.Recipient.DeliveryState = domain.DeliveryStateDelivered
			message.Recipient.DeliveredAt = &deliveredAt
			messages[index] = message
			deviceID := principal.DeviceID
			s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventMessageDelivered, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
				"messageId":      message.Envelope.ID,
				"conversationId": message.Envelope.ConversationID,
			})
		}
	}

	if _, err := s.repo.UpsertDeviceSyncCursor(ctx, domain.DeviceSyncCursor{
		CursorID:   cursorID,
		DeviceID:   principal.DeviceID,
		LastCursor: toCursor,
		UpdatedAt:  time.Now().UTC(),
	}); err != nil {
		return SyncBatch{}, service.NewError(service.ErrorCodeInternal, "failed to update device sync cursor")
	}

	return SyncBatch{
		CursorID:   cursorID,
		FromCursor: fromCursor,
		ToCursor:   toCursor,
		Messages:   messages,
		HasMore:    len(messages) >= limit,
	}, nil
}

func (s *Service) getOrCreateCursor(ctx context.Context, deviceID string) (domain.DeviceSyncCursor, error) {
	cursor, err := s.repo.GetDeviceSyncCursor(ctx, deviceID)
	if err == nil {
		return cursor, nil
	}
	if err != postgres.ErrNotFound {
		return domain.DeviceSyncCursor{}, service.NewError(service.ErrorCodeInternal, "failed to load device cursor")
	}

	created, createErr := s.repo.UpsertDeviceSyncCursor(ctx, domain.DeviceSyncCursor{
		CursorID:   security.NewID(),
		DeviceID:   deviceID,
		LastCursor: 0,
		UpdatedAt:  time.Now().UTC(),
	})
	if createErr != nil {
		return domain.DeviceSyncCursor{}, service.NewError(service.ErrorCodeInternal, "failed to create device cursor")
	}
	return created, nil
}

func (s *Service) hydrateMessageRows(ctx context.Context, rows []postgres.MessageWithRecipient) ([]MessageView, error) {
	messageIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		messageIDs = append(messageIDs, row.Envelope.ID)
	}
	receiptsByMessage, err := s.repo.ListMessageReceiptsByMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load message receipts")
	}
	attachmentsByMessage, err := s.repo.ListAttachmentsByMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load message attachments")
	}

	result := make([]MessageView, 0, len(rows))
	for _, row := range rows {
		result = append(result, MessageView{
			Envelope:    row.Envelope,
			Recipient:   row.Recipient,
			Receipts:    receiptsByMessage[row.Envelope.ID],
			Attachments: attachmentsByMessage[row.Envelope.ID],
		})
	}
	return result, nil
}

func (s *Service) loadMessageViewByID(ctx context.Context, deviceID string, messageID string) (MessageView, error) {
	message, err := s.repo.GetMessageByID(ctx, messageID)
	if err != nil {
		return MessageView{}, service.NewError(service.ErrorCodeNotFound, "message not found")
	}
	recipient, err := s.repo.GetMessageRecipient(ctx, messageID, deviceID)
	var recipientPtr *domain.MessageRecipient
	if err == nil {
		recipientPtr = &recipient
	}
	receiptsByMessage, _ := s.repo.ListMessageReceiptsByMessageIDs(ctx, []string{messageID})
	attachmentsByMessage, _ := s.repo.ListAttachmentsByMessageIDs(ctx, []string{messageID})
	return MessageView{
		Envelope:    message,
		Recipient:   recipientPtr,
		Receipts:    receiptsByMessage[messageID],
		Attachments: attachmentsByMessage[messageID],
	}, nil
}

func (s *Service) loadConversationWithMembers(ctx context.Context, conversationID string) (ConversationWithMembers, error) {
	conversation, err := s.repo.GetConversationByID(ctx, conversationID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return ConversationWithMembers{}, service.NewError(service.ErrorCodeConversationNotFound, "conversation not found")
		}
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to fetch conversation")
	}
	members, err := s.repo.ListConversationMembers(ctx, conversation.ID)
	if err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to fetch conversation members")
	}
	trustedDevices, err := s.repo.ListTrustedDevicesForConversation(ctx, conversation.ID)
	if err != nil {
		return ConversationWithMembers{}, service.NewError(service.ErrorCodeInternal, "failed to fetch trusted conversation devices")
	}

	devicesByAccount := make(map[string][]domain.Device)
	for _, device := range trustedDevices {
		devicesByAccount[device.AccountID] = append(devicesByAccount[device.AccountID], device)
	}

	resultMembers := make([]ConversationMemberWithDevices, 0, len(members))
	for _, member := range members {
		resultMembers = append(resultMembers, ConversationMemberWithDevices{
			Member:         member,
			TrustedDevices: devicesByAccount[member.AccountID],
		})
	}

	return ConversationWithMembers{
		Conversation: conversation,
		Members:      resultMembers,
	}, nil
}

func (s *Service) cleanupExpiredUnattached(ctx context.Context) error {
	expired, err := s.repo.ListExpiredUnboundAttachments(ctx, time.Now().UTC())
	if err != nil {
		return err
	}
	for _, attachment := range expired {
		resolvedPath, resolveErr := s.resolveAttachmentPath(attachment.StoragePath)
		if resolveErr == nil {
			_ = os.Remove(resolvedPath)
		}
		_ = s.repo.DeleteAttachmentObject(ctx, attachment.ID)
	}
	return nil
}

func hasActiveMember(members []ConversationMemberWithDevices, accountID string) bool {
	for _, member := range members {
		if member.Member.AccountID == accountID && member.Member.IsActive {
			return true
		}
	}
	return false
}

func findMember(members []ConversationMemberWithDevices, accountID string) (ConversationMemberWithDevices, bool) {
	for _, member := range members {
		if member.Member.AccountID == accountID {
			return member, true
		}
	}
	return ConversationMemberWithDevices{}, false
}

func isPathInsideBase(path string, baseDir string) bool {
	resolvedBase, err := canonicalDir(baseDir)
	if err != nil {
		return false
	}

	resolvedPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}
	if canonicalPath, canonicalErr := filepath.EvalSymlinks(resolvedPath); canonicalErr == nil {
		resolvedPath = canonicalPath
	}
	relative, err := filepath.Rel(resolvedBase, resolvedPath)
	if err != nil {
		return false
	}
	if relative == "." {
		return true
	}
	return !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != ".."
}

func canonicalDir(path string) (string, error) {
	absolutePath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	if canonical, canonicalErr := filepath.EvalSymlinks(absolutePath); canonicalErr == nil {
		return canonical, nil
	}
	return absolutePath, nil
}

func (s *Service) resolveAttachmentPath(path string) (string, error) {
	baseDir, err := canonicalDir(s.cfg.Messaging.AttachmentsDir)
	if err != nil {
		return "", err
	}
	if !isPathInsideBase(path, baseDir) {
		return "", fmt.Errorf("path outside attachment root")
	}
	return filepath.Abs(filepath.Clean(path))
}
