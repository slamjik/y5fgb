package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateAttachmentObject(ctx context.Context, attachment domain.AttachmentObject) (domain.AttachmentObject, error) {
	if attachment.CreatedAt.IsZero() {
		attachment.CreatedAt = time.Now().UTC()
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO attachment_objects (
			id,
			account_id,
			kind,
			file_name,
			mime_type,
			size_bytes,
			checksum_sha256,
			algorithm,
			nonce,
			storage_path,
			message_id,
			created_at,
			expires_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING created_at
	`, attachment.ID, attachment.AccountID, attachment.Kind, attachment.FileName, attachment.MimeType, attachment.SizeBytes, attachment.ChecksumSHA256, attachment.Algorithm, attachment.Nonce, attachment.StoragePath, attachment.MessageID, attachment.CreatedAt, attachment.ExpiresAt).Scan(&attachment.CreatedAt)
	if err != nil {
		return domain.AttachmentObject{}, fmt.Errorf("failed to create attachment object: %w", err)
	}
	return attachment, nil
}

func (s *Store) GetAttachmentObjectByID(ctx context.Context, attachmentID string) (domain.AttachmentObject, error) {
	var attachment domain.AttachmentObject
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, kind, file_name, mime_type, size_bytes, checksum_sha256, algorithm, nonce, storage_path, created_at, expires_at, message_id
		FROM attachment_objects
		WHERE id = $1
	`, attachmentID).Scan(
		&attachment.ID,
		&attachment.AccountID,
		&attachment.Kind,
		&attachment.FileName,
		&attachment.MimeType,
		&attachment.SizeBytes,
		&attachment.ChecksumSHA256,
		&attachment.Algorithm,
		&attachment.Nonce,
		&attachment.StoragePath,
		&attachment.CreatedAt,
		&attachment.ExpiresAt,
		&attachment.MessageID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AttachmentObject{}, ErrNotFound
		}
		return domain.AttachmentObject{}, fmt.Errorf("failed to fetch attachment object: %w", err)
	}
	return attachment, nil
}

func (s *Store) ListAttachmentsByMessageIDs(ctx context.Context, messageIDs []string) (map[string][]domain.AttachmentObject, error) {
	result := make(map[string][]domain.AttachmentObject)
	if len(messageIDs) == 0 {
		return result, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ao.id, ao.account_id, ao.kind, ao.file_name, ao.mime_type, ao.size_bytes, ao.checksum_sha256, ao.algorithm, ao.nonce, ao.storage_path, ao.created_at, ao.expires_at, ar.message_id
		FROM attachment_refs ar
		JOIN attachment_objects ao ON ao.id = ar.attachment_id
		WHERE ar.message_id = ANY($1::uuid[])
		ORDER BY ar.created_at ASC
	`, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list attachments by message ids: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var attachment domain.AttachmentObject
		var messageID string
		if err := rows.Scan(
			&attachment.ID,
			&attachment.AccountID,
			&attachment.Kind,
			&attachment.FileName,
			&attachment.MimeType,
			&attachment.SizeBytes,
			&attachment.ChecksumSHA256,
			&attachment.Algorithm,
			&attachment.Nonce,
			&attachment.StoragePath,
			&attachment.CreatedAt,
			&attachment.ExpiresAt,
			&messageID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan attachment row: %w", err)
		}
		msgID := messageID
		attachment.MessageID = &msgID
		result[messageID] = append(result[messageID], attachment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate attachment rows: %w", err)
	}

	return result, nil
}

func (s *Store) ListExpiredUnboundAttachments(ctx context.Context, expiresBefore time.Time) ([]domain.AttachmentObject, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, account_id, kind, file_name, mime_type, size_bytes, checksum_sha256, algorithm, nonce, storage_path, created_at, expires_at, message_id
		FROM attachment_objects
		WHERE message_id IS NULL
		  AND expires_at IS NOT NULL
		  AND expires_at < $1
	`, expiresBefore)
	if err != nil {
		return nil, fmt.Errorf("failed to list expired unbound attachments: %w", err)
	}
	defer rows.Close()

	result := make([]domain.AttachmentObject, 0)
	for rows.Next() {
		var attachment domain.AttachmentObject
		if err := rows.Scan(
			&attachment.ID,
			&attachment.AccountID,
			&attachment.Kind,
			&attachment.FileName,
			&attachment.MimeType,
			&attachment.SizeBytes,
			&attachment.ChecksumSHA256,
			&attachment.Algorithm,
			&attachment.Nonce,
			&attachment.StoragePath,
			&attachment.CreatedAt,
			&attachment.ExpiresAt,
			&attachment.MessageID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan expired attachment row: %w", err)
		}
		result = append(result, attachment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate expired attachment rows: %w", err)
	}

	return result, nil
}

func (s *Store) DeleteAttachmentObject(ctx context.Context, attachmentID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM attachment_objects WHERE id = $1`, attachmentID)
	if err != nil {
		return fmt.Errorf("failed to delete attachment object: %w", err)
	}
	return nil
}
