package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

type MessageWithRecipient struct {
	Envelope  domain.MessageEnvelope
	Recipient *domain.MessageRecipient
}

func (s *Store) GetMessageBySenderClientID(ctx context.Context, senderDeviceID string, clientMessageID string) (domain.MessageEnvelope, error) {
	var message domain.MessageEnvelope
	err := s.pool.QueryRow(ctx, `
		SELECT id, conversation_id, sender_account_id, sender_device_id, client_message_id, algorithm, crypto_version, nonce, ciphertext, reply_to_message_id, ttl_seconds, expires_at, server_sequence, created_at, edited_at, deleted_at
		FROM message_envelopes
		WHERE sender_device_id = $1 AND client_message_id = $2
	`, senderDeviceID, clientMessageID).Scan(
		&message.ID,
		&message.ConversationID,
		&message.SenderAccountID,
		&message.SenderDeviceID,
		&message.ClientMessageID,
		&message.Algorithm,
		&message.CryptoVersion,
		&message.Nonce,
		&message.Ciphertext,
		&message.ReplyToMessageID,
		&message.TTLSeconds,
		&message.ExpiresAt,
		&message.ServerSequence,
		&message.CreatedAt,
		&message.EditedAt,
		&message.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MessageEnvelope{}, ErrNotFound
		}
		return domain.MessageEnvelope{}, fmt.Errorf("failed to fetch message by sender+client id: %w", err)
	}
	return message, nil
}

func (s *Store) GetMessageByID(ctx context.Context, messageID string) (domain.MessageEnvelope, error) {
	var message domain.MessageEnvelope
	err := s.pool.QueryRow(ctx, `
		SELECT id, conversation_id, sender_account_id, sender_device_id, client_message_id, algorithm, crypto_version, nonce, ciphertext, reply_to_message_id, ttl_seconds, expires_at, server_sequence, created_at, edited_at, deleted_at
		FROM message_envelopes
		WHERE id = $1
	`, messageID).Scan(
		&message.ID,
		&message.ConversationID,
		&message.SenderAccountID,
		&message.SenderDeviceID,
		&message.ClientMessageID,
		&message.Algorithm,
		&message.CryptoVersion,
		&message.Nonce,
		&message.Ciphertext,
		&message.ReplyToMessageID,
		&message.TTLSeconds,
		&message.ExpiresAt,
		&message.ServerSequence,
		&message.CreatedAt,
		&message.EditedAt,
		&message.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MessageEnvelope{}, ErrNotFound
		}
		return domain.MessageEnvelope{}, fmt.Errorf("failed to fetch message by id: %w", err)
	}
	return message, nil
}

func (s *Store) InsertMessageWithRecipients(ctx context.Context, message domain.MessageEnvelope, recipients []domain.MessageRecipient, attachmentIDs []string) (domain.MessageEnvelope, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if message.CreatedAt.IsZero() {
		message.CreatedAt = time.Now().UTC()
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO message_envelopes (
			id,
			conversation_id,
			sender_account_id,
			sender_device_id,
			client_message_id,
			algorithm,
			crypto_version,
			nonce,
			ciphertext,
			reply_to_message_id,
			ttl_seconds,
			expires_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING server_sequence, created_at
	`, message.ID, message.ConversationID, message.SenderAccountID, message.SenderDeviceID, message.ClientMessageID, message.Algorithm, message.CryptoVersion, message.Nonce, message.Ciphertext, message.ReplyToMessageID, message.TTLSeconds, message.ExpiresAt, message.CreatedAt).Scan(
		&message.ServerSequence,
		&message.CreatedAt,
	)
	if err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to insert message envelope: %w", err)
	}

	for _, recipient := range recipients {
		if recipient.QueuedAt.IsZero() {
			recipient.QueuedAt = message.CreatedAt
		}
		_, insertErr := tx.Exec(ctx, `
			INSERT INTO message_recipients (
				message_id,
				recipient_account_id,
				recipient_device_id,
				wrapped_key,
				key_algorithm,
				delivery_state,
				queued_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
		`, recipient.MessageID, recipient.RecipientAccountID, recipient.RecipientDeviceID, recipient.WrappedKey, recipient.KeyAlgorithm, recipient.DeliveryState, recipient.QueuedAt)
		if insertErr != nil {
			return domain.MessageEnvelope{}, fmt.Errorf("failed to insert message recipient: %w", insertErr)
		}
	}

	for _, attachmentID := range attachmentIDs {
		_, refErr := tx.Exec(ctx, `
			INSERT INTO attachment_refs (message_id, attachment_id, created_at)
			VALUES ($1,$2,NOW())
			ON CONFLICT (message_id, attachment_id) DO NOTHING
		`, message.ID, attachmentID)
		if refErr != nil {
			return domain.MessageEnvelope{}, fmt.Errorf("failed to insert attachment ref: %w", refErr)
		}
		_, updateErr := tx.Exec(ctx, `
			UPDATE attachment_objects
			SET message_id = $2
			WHERE id = $1
		`, attachmentID, message.ID)
		if updateErr != nil {
			return domain.MessageEnvelope{}, fmt.Errorf("failed to bind attachment to message: %w", updateErr)
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE conversations
		SET last_server_sequence = GREATEST(last_server_sequence, $2),
			updated_at = NOW()
		WHERE id = $1
	`, message.ConversationID, message.ServerSequence)
	if err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to update conversation sequence: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to commit message tx: %w", err)
	}

	return message, nil
}

func (s *Store) UpdateMessageWithRecipients(
	ctx context.Context,
	messageID string,
	algorithm string,
	cryptoVersion int,
	nonce string,
	ciphertext string,
	recipients []domain.MessageRecipient,
) (domain.MessageEnvelope, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var message domain.MessageEnvelope
	if err := tx.QueryRow(ctx, `
		UPDATE message_envelopes
		SET algorithm = $2,
			crypto_version = $3,
			nonce = $4,
			ciphertext = $5,
			edited_at = NOW(),
			server_sequence = nextval(pg_get_serial_sequence('message_envelopes', 'server_sequence'))
		WHERE id = $1
		RETURNING id, conversation_id, sender_account_id, sender_device_id, client_message_id, algorithm, crypto_version, nonce, ciphertext, reply_to_message_id, ttl_seconds, expires_at, server_sequence, created_at, edited_at, deleted_at
	`, messageID, algorithm, cryptoVersion, nonce, ciphertext).Scan(
		&message.ID,
		&message.ConversationID,
		&message.SenderAccountID,
		&message.SenderDeviceID,
		&message.ClientMessageID,
		&message.Algorithm,
		&message.CryptoVersion,
		&message.Nonce,
		&message.Ciphertext,
		&message.ReplyToMessageID,
		&message.TTLSeconds,
		&message.ExpiresAt,
		&message.ServerSequence,
		&message.CreatedAt,
		&message.EditedAt,
		&message.DeletedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MessageEnvelope{}, ErrNotFound
		}
		return domain.MessageEnvelope{}, fmt.Errorf("failed to update message envelope: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM message_recipients WHERE message_id = $1`, messageID); err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to reset message recipients: %w", err)
	}

	queuedAt := time.Now().UTC()
	for _, recipient := range recipients {
		recipientQueuedAt := recipient.QueuedAt
		if recipientQueuedAt.IsZero() {
			recipientQueuedAt = queuedAt
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO message_recipients (
				message_id,
				recipient_account_id,
				recipient_device_id,
				wrapped_key,
				key_algorithm,
				delivery_state,
				queued_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
		`, messageID, recipient.RecipientAccountID, recipient.RecipientDeviceID, recipient.WrappedKey, recipient.KeyAlgorithm, recipient.DeliveryState, recipientQueuedAt); err != nil {
			return domain.MessageEnvelope{}, fmt.Errorf("failed to upsert message recipient: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE conversations
		SET last_server_sequence = GREATEST(last_server_sequence, $2),
			updated_at = NOW()
		WHERE id = $1
	`, message.ConversationID, message.ServerSequence); err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to update conversation sequence: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.MessageEnvelope{}, fmt.Errorf("failed to commit message update tx: %w", err)
	}

	return message, nil
}

func (s *Store) ListConversationMessagesForDevice(ctx context.Context, conversationID string, deviceID string, limit int, beforeSequence int64) ([]MessageWithRecipient, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	query := `
		SELECT
			me.id,
			me.conversation_id,
			me.sender_account_id,
			me.sender_device_id,
			me.client_message_id,
			me.algorithm,
			me.crypto_version,
			me.nonce,
			me.ciphertext,
			me.reply_to_message_id,
			me.ttl_seconds,
			me.expires_at,
			me.server_sequence,
			me.created_at,
			me.edited_at,
			me.deleted_at,
			mr.recipient_account_id,
			mr.recipient_device_id,
			mr.wrapped_key,
			mr.key_algorithm,
			mr.delivery_state,
			mr.queued_at,
			mr.delivered_at,
			mr.failed_reason
		FROM message_envelopes me
		LEFT JOIN message_recipients mr
			ON mr.message_id = me.id
			AND mr.recipient_device_id = $2
		WHERE me.conversation_id = $1
		  AND (me.expires_at IS NULL OR me.expires_at > NOW())
	`

	args := []any{conversationID, deviceID}
	if beforeSequence > 0 {
		query += " AND me.server_sequence < $3"
		args = append(args, beforeSequence)
	}
	query += `
		ORDER BY me.server_sequence DESC
		LIMIT $` + fmt.Sprintf("%d", len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversation messages: %w", err)
	}
	defer rows.Close()

	result := make([]MessageWithRecipient, 0)
	for rows.Next() {
		var item MessageWithRecipient
		var recipientAccountID *string
		var recipientDeviceID *string
		var wrappedKey *string
		var keyAlgorithm *string
		var deliveryState *domain.DeliveryState
		var queuedAt *time.Time
		var deliveredAt *time.Time
		var failedReason *string

		if err := rows.Scan(
			&item.Envelope.ID,
			&item.Envelope.ConversationID,
			&item.Envelope.SenderAccountID,
			&item.Envelope.SenderDeviceID,
			&item.Envelope.ClientMessageID,
			&item.Envelope.Algorithm,
			&item.Envelope.CryptoVersion,
			&item.Envelope.Nonce,
			&item.Envelope.Ciphertext,
			&item.Envelope.ReplyToMessageID,
			&item.Envelope.TTLSeconds,
			&item.Envelope.ExpiresAt,
			&item.Envelope.ServerSequence,
			&item.Envelope.CreatedAt,
			&item.Envelope.EditedAt,
			&item.Envelope.DeletedAt,
			&recipientAccountID,
			&recipientDeviceID,
			&wrappedKey,
			&keyAlgorithm,
			&deliveryState,
			&queuedAt,
			&deliveredAt,
			&failedReason,
		); err != nil {
			return nil, fmt.Errorf("failed to scan conversation message row: %w", err)
		}

		if recipientDeviceID != nil && recipientAccountID != nil && wrappedKey != nil && keyAlgorithm != nil && deliveryState != nil && queuedAt != nil {
			item.Recipient = &domain.MessageRecipient{
				MessageID:          item.Envelope.ID,
				RecipientAccountID: *recipientAccountID,
				RecipientDeviceID:  *recipientDeviceID,
				WrappedKey:         *wrappedKey,
				KeyAlgorithm:       *keyAlgorithm,
				DeliveryState:      *deliveryState,
				QueuedAt:           *queuedAt,
				DeliveredAt:        deliveredAt,
				FailedReason:       failedReason,
			}
		}

		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate conversation message rows: %w", err)
	}

	for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
		result[left], result[right] = result[right], result[left]
	}

	return result, nil
}

func (s *Store) ListDeliverableMessagesSince(ctx context.Context, deviceID string, sinceSequence int64, limit int) ([]MessageWithRecipient, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			me.id,
			me.conversation_id,
			me.sender_account_id,
			me.sender_device_id,
			me.client_message_id,
			me.algorithm,
			me.crypto_version,
			me.nonce,
			me.ciphertext,
			me.reply_to_message_id,
			me.ttl_seconds,
			me.expires_at,
			me.server_sequence,
			me.created_at,
			me.edited_at,
			me.deleted_at,
			mr.recipient_account_id,
			mr.recipient_device_id,
			mr.wrapped_key,
			mr.key_algorithm,
			mr.delivery_state,
			mr.queued_at,
			mr.delivered_at,
			mr.failed_reason
		FROM message_recipients mr
		JOIN message_envelopes me ON me.id = mr.message_id
		WHERE mr.recipient_device_id = $1
		  AND me.server_sequence > $2
		  AND (me.expires_at IS NULL OR me.expires_at > NOW())
		ORDER BY me.server_sequence ASC
		LIMIT $3
	`, deviceID, sinceSequence, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list deliverable messages: %w", err)
	}
	defer rows.Close()

	items := make([]MessageWithRecipient, 0)
	for rows.Next() {
		var item MessageWithRecipient
		var recipient domain.MessageRecipient
		if err := rows.Scan(
			&item.Envelope.ID,
			&item.Envelope.ConversationID,
			&item.Envelope.SenderAccountID,
			&item.Envelope.SenderDeviceID,
			&item.Envelope.ClientMessageID,
			&item.Envelope.Algorithm,
			&item.Envelope.CryptoVersion,
			&item.Envelope.Nonce,
			&item.Envelope.Ciphertext,
			&item.Envelope.ReplyToMessageID,
			&item.Envelope.TTLSeconds,
			&item.Envelope.ExpiresAt,
			&item.Envelope.ServerSequence,
			&item.Envelope.CreatedAt,
			&item.Envelope.EditedAt,
			&item.Envelope.DeletedAt,
			&recipient.RecipientAccountID,
			&recipient.RecipientDeviceID,
			&recipient.WrappedKey,
			&recipient.KeyAlgorithm,
			&recipient.DeliveryState,
			&recipient.QueuedAt,
			&recipient.DeliveredAt,
			&recipient.FailedReason,
		); err != nil {
			return nil, fmt.Errorf("failed to scan deliverable message row: %w", err)
		}
		recipient.MessageID = item.Envelope.ID
		item.Recipient = &recipient
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate deliverable message rows: %w", err)
	}

	return items, nil
}

func (s *Store) MarkMessageDelivered(ctx context.Context, messageID string, recipientDeviceID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE message_recipients
		SET delivery_state = 'delivered',
			delivered_at = NOW()
		WHERE message_id = $1
		  AND recipient_device_id = $2
		  AND delivery_state <> 'delivered'
	`, messageID, recipientDeviceID)
	if err != nil {
		return fmt.Errorf("failed to mark message delivered: %w", err)
	}
	return nil
}

func (s *Store) GetMessageRecipient(ctx context.Context, messageID string, recipientDeviceID string) (domain.MessageRecipient, error) {
	var recipient domain.MessageRecipient
	err := s.pool.QueryRow(ctx, `
		SELECT message_id, recipient_account_id, recipient_device_id, wrapped_key, key_algorithm, delivery_state, queued_at, delivered_at, failed_reason
		FROM message_recipients
		WHERE message_id = $1 AND recipient_device_id = $2
	`, messageID, recipientDeviceID).Scan(
		&recipient.MessageID,
		&recipient.RecipientAccountID,
		&recipient.RecipientDeviceID,
		&recipient.WrappedKey,
		&recipient.KeyAlgorithm,
		&recipient.DeliveryState,
		&recipient.QueuedAt,
		&recipient.DeliveredAt,
		&recipient.FailedReason,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MessageRecipient{}, ErrNotFound
		}
		return domain.MessageRecipient{}, fmt.Errorf("failed to fetch message recipient: %w", err)
	}
	return recipient, nil
}

func (s *Store) CreateMessageReceipt(ctx context.Context, receipt domain.MessageReceipt) (domain.MessageReceipt, error) {
	if receipt.CreatedAt.IsZero() {
		receipt.CreatedAt = time.Now().UTC()
	}

	err := s.pool.QueryRow(ctx, `
		INSERT INTO message_receipts (id, message_id, device_id, receipt_type, created_at)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (message_id, device_id, receipt_type) DO UPDATE
		SET created_at = EXCLUDED.created_at
		RETURNING sequence, created_at
	`, receipt.ID, receipt.MessageID, receipt.DeviceID, receipt.ReceiptType, receipt.CreatedAt).Scan(
		&receipt.Sequence,
		&receipt.CreatedAt,
	)
	if err != nil {
		return domain.MessageReceipt{}, fmt.Errorf("failed to create message receipt: %w", err)
	}

	return receipt, nil
}

func (s *Store) ListMessageReceiptsByMessageIDs(ctx context.Context, messageIDs []string) (map[string][]domain.MessageReceipt, error) {
	result := make(map[string][]domain.MessageReceipt)
	if len(messageIDs) == 0 {
		return result, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, message_id, device_id, receipt_type, sequence, created_at
		FROM message_receipts
		WHERE message_id = ANY($1::uuid[])
		ORDER BY created_at ASC
	`, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list message receipts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var receipt domain.MessageReceipt
		if err := rows.Scan(
			&receipt.ID,
			&receipt.MessageID,
			&receipt.DeviceID,
			&receipt.ReceiptType,
			&receipt.Sequence,
			&receipt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan message receipt row: %w", err)
		}
		result[receipt.MessageID] = append(result[receipt.MessageID], receipt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate message receipt rows: %w", err)
	}

	return result, nil
}
