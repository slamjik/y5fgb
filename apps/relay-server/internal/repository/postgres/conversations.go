package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func normalizeDirectPair(accountA string, accountB string) (string, string) {
	if accountA < accountB {
		return accountA, accountB
	}
	return accountB, accountA
}

func (s *Store) FindDirectConversationByPair(ctx context.Context, accountA string, accountB string) (domain.Conversation, error) {
	left, right := normalizeDirectPair(accountA, accountB)
	var conversation domain.Conversation
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.kind, c.title, c.created_by_account_id, c.default_ttl_seconds, c.allow_ttl_override, c.last_server_sequence, c.created_at, c.updated_at
		FROM direct_conversations dc
		JOIN conversations c ON c.id = dc.conversation_id
		WHERE dc.account_a_id = $1 AND dc.account_b_id = $2
	`, left, right).Scan(
		&conversation.ID,
		&conversation.Type,
		&conversation.Title,
		&conversation.CreatedByAccountID,
		&conversation.DefaultTTLSeconds,
		&conversation.AllowTTLOverride,
		&conversation.LastServerSequence,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Conversation{}, ErrNotFound
		}
		return domain.Conversation{}, fmt.Errorf("failed to find direct conversation: %w", err)
	}

	return conversation, nil
}

func (s *Store) CreateDirectConversation(ctx context.Context, conversation domain.Conversation, memberA domain.ConversationMember, memberB domain.ConversationMember) (domain.Conversation, error) {
	left, right := normalizeDirectPair(memberA.AccountID, memberB.AccountID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	now := time.Now().UTC()
	if conversation.CreatedAt.IsZero() {
		conversation.CreatedAt = now
	}
	conversation.UpdatedAt = conversation.CreatedAt
	memberA.JoinedAt = conversation.CreatedAt
	memberB.JoinedAt = conversation.CreatedAt

	_, err = tx.Exec(ctx, `
		INSERT INTO conversations (
			id, kind, title, created_by_account_id, default_ttl_seconds, allow_ttl_override, last_server_sequence, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, conversation.ID, conversation.Type, conversation.Title, conversation.CreatedByAccountID, conversation.DefaultTTLSeconds, conversation.AllowTTLOverride, conversation.LastServerSequence, conversation.CreatedAt, conversation.UpdatedAt)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to create conversation: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO direct_conversations (conversation_id, account_a_id, account_b_id)
		VALUES ($1,$2,$3)
	`, conversation.ID, left, right)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to create direct conversation index: %w", err)
	}

	for _, member := range []domain.ConversationMember{memberA, memberB} {
		_, memberErr := tx.Exec(ctx, `
			INSERT INTO conversation_members (conversation_id, account_id, role, joined_at, is_active)
			VALUES ($1,$2,$3,$4,$5)
		`, member.ConversationID, member.AccountID, member.Role, member.JoinedAt, member.IsActive)
		if memberErr != nil {
			return domain.Conversation{}, fmt.Errorf("failed to insert direct conversation member: %w", memberErr)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to commit direct conversation tx: %w", err)
	}

	return conversation, nil
}

func (s *Store) CreateGroupConversation(ctx context.Context, conversation domain.Conversation, members []domain.ConversationMember) (domain.Conversation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	now := time.Now().UTC()
	if conversation.CreatedAt.IsZero() {
		conversation.CreatedAt = now
	}
	conversation.UpdatedAt = conversation.CreatedAt

	_, err = tx.Exec(ctx, `
		INSERT INTO conversations (
			id, kind, title, created_by_account_id, default_ttl_seconds, allow_ttl_override, last_server_sequence, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, conversation.ID, conversation.Type, conversation.Title, conversation.CreatedByAccountID, conversation.DefaultTTLSeconds, conversation.AllowTTLOverride, conversation.LastServerSequence, conversation.CreatedAt, conversation.UpdatedAt)
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to create group conversation: %w", err)
	}

	for _, member := range members {
		joinedAt := member.JoinedAt
		if joinedAt.IsZero() {
			joinedAt = conversation.CreatedAt
		}
		_, memberErr := tx.Exec(ctx, `
			INSERT INTO conversation_members (conversation_id, account_id, role, joined_at, is_active)
			VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (conversation_id, account_id) DO UPDATE
			SET role = EXCLUDED.role,
				is_active = EXCLUDED.is_active
		`, member.ConversationID, member.AccountID, member.Role, joinedAt, member.IsActive)
		if memberErr != nil {
			return domain.Conversation{}, fmt.Errorf("failed to insert group member: %w", memberErr)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Conversation{}, fmt.Errorf("failed to commit group conversation tx: %w", err)
	}

	return conversation, nil
}

func (s *Store) AddConversationMember(ctx context.Context, member domain.ConversationMember) error {
	if member.JoinedAt.IsZero() {
		member.JoinedAt = time.Now().UTC()
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO conversation_members (conversation_id, account_id, role, joined_at, is_active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (conversation_id, account_id) DO UPDATE
		SET role = EXCLUDED.role,
			is_active = EXCLUDED.is_active
	`, member.ConversationID, member.AccountID, member.Role, member.JoinedAt, member.IsActive)
	if err != nil {
		return fmt.Errorf("failed to add conversation member: %w", err)
	}
	return nil
}

func (s *Store) ListConversationsByAccount(ctx context.Context, accountID string) ([]domain.Conversation, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.kind, c.title, c.created_by_account_id, c.default_ttl_seconds, c.allow_ttl_override, c.last_server_sequence, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_members cm ON cm.conversation_id = c.id
		WHERE cm.account_id = $1 AND cm.is_active = TRUE
		ORDER BY c.updated_at DESC
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversations: %w", err)
	}
	defer rows.Close()

	conversations := make([]domain.Conversation, 0)
	for rows.Next() {
		var conversation domain.Conversation
		if err := rows.Scan(
			&conversation.ID,
			&conversation.Type,
			&conversation.Title,
			&conversation.CreatedByAccountID,
			&conversation.DefaultTTLSeconds,
			&conversation.AllowTTLOverride,
			&conversation.LastServerSequence,
			&conversation.CreatedAt,
			&conversation.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan conversation row: %w", err)
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate conversation rows: %w", err)
	}

	return conversations, nil
}

func (s *Store) GetConversationByID(ctx context.Context, conversationID string) (domain.Conversation, error) {
	var conversation domain.Conversation
	err := s.pool.QueryRow(ctx, `
		SELECT id, kind, title, created_by_account_id, default_ttl_seconds, allow_ttl_override, last_server_sequence, created_at, updated_at
		FROM conversations
		WHERE id = $1
	`, conversationID).Scan(
		&conversation.ID,
		&conversation.Type,
		&conversation.Title,
		&conversation.CreatedByAccountID,
		&conversation.DefaultTTLSeconds,
		&conversation.AllowTTLOverride,
		&conversation.LastServerSequence,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Conversation{}, ErrNotFound
		}
		return domain.Conversation{}, fmt.Errorf("failed to fetch conversation by id: %w", err)
	}

	return conversation, nil
}

func (s *Store) GetConversationMember(ctx context.Context, conversationID string, accountID string) (domain.ConversationMember, error) {
	var member domain.ConversationMember
	err := s.pool.QueryRow(ctx, `
		SELECT conversation_id, account_id, role, joined_at, is_active
		FROM conversation_members
		WHERE conversation_id = $1 AND account_id = $2
	`, conversationID, accountID).Scan(
		&member.ConversationID,
		&member.AccountID,
		&member.Role,
		&member.JoinedAt,
		&member.IsActive,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ConversationMember{}, ErrNotFound
		}
		return domain.ConversationMember{}, fmt.Errorf("failed to fetch conversation member: %w", err)
	}

	return member, nil
}

func (s *Store) ListConversationMembers(ctx context.Context, conversationID string) ([]domain.ConversationMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT conversation_id, account_id, role, joined_at, is_active
		FROM conversation_members
		WHERE conversation_id = $1
		ORDER BY joined_at ASC
	`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversation members: %w", err)
	}
	defer rows.Close()

	members := make([]domain.ConversationMember, 0)
	for rows.Next() {
		var member domain.ConversationMember
		if err := rows.Scan(
			&member.ConversationID,
			&member.AccountID,
			&member.Role,
			&member.JoinedAt,
			&member.IsActive,
		); err != nil {
			return nil, fmt.Errorf("failed to scan conversation member row: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate conversation member rows: %w", err)
	}

	return members, nil
}

func (s *Store) ListTrustedDevicesForConversation(ctx context.Context, conversationID string) ([]domain.Device, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT d.id, d.account_id, d.name, d.platform, d.public_device_material, d.fingerprint, d.status, d.verification_state, d.key_version, d.rotated_at, d.rotation_due_at, d.created_at, d.last_seen_at, d.revoked_at
		FROM conversation_members cm
		JOIN devices d ON d.account_id = cm.account_id
		WHERE cm.conversation_id = $1
		  AND cm.is_active = TRUE
		  AND d.status = 'trusted'
		ORDER BY d.created_at ASC
	`, conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to list trusted devices for conversation: %w", err)
	}
	defer rows.Close()

	devices := make([]domain.Device, 0)
	for rows.Next() {
		var device domain.Device
		if err := rows.Scan(
			&device.ID,
			&device.AccountID,
			&device.Name,
			&device.Platform,
			&device.PublicDeviceMaterial,
			&device.Fingerprint,
			&device.Status,
			&device.VerificationState,
			&device.KeyVersion,
			&device.RotatedAt,
			&device.RotationDueAt,
			&device.CreatedAt,
			&device.LastSeenAt,
			&device.RevokedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan trusted device row: %w", err)
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate trusted device rows: %w", err)
	}

	return devices, nil
}
