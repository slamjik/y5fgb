package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateMediaObject(ctx context.Context, media domain.MediaObject) (domain.MediaObject, error) {
	if media.CreatedAt.IsZero() {
		media.CreatedAt = time.Now().UTC()
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO media_objects (
			id,
			owner_account_id,
			domain,
			kind,
			storage_backend,
			bucket,
			object_key,
			mime_type,
			size_bytes,
			checksum_sha256,
			width,
			height,
			duration_ms,
			visibility,
			status,
			created_at,
			expires_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		RETURNING created_at
	`, media.ID, media.OwnerAccountID, media.Domain, media.Kind, media.StorageBackend, media.Bucket, media.ObjectKey, media.MimeType, media.SizeBytes, media.ChecksumSHA256, media.Width, media.Height, media.DurationMS, media.Visibility, media.Status, media.CreatedAt, media.ExpiresAt).Scan(
		&media.CreatedAt,
	)
	if err != nil {
		return domain.MediaObject{}, fmt.Errorf("failed to create media object: %w", err)
	}
	return media, nil
}

func (s *Store) GetMediaObjectByID(ctx context.Context, mediaID string) (domain.MediaObject, error) {
	var media domain.MediaObject
	err := s.pool.QueryRow(ctx, `
		SELECT
			id,
			owner_account_id,
			domain,
			kind,
			storage_backend,
			bucket,
			object_key,
			mime_type,
			size_bytes,
			checksum_sha256,
			width,
			height,
			duration_ms,
			visibility,
			status,
			created_at,
			expires_at,
			deleted_at
		FROM media_objects
		WHERE id = $1
	`, mediaID).Scan(
		&media.ID,
		&media.OwnerAccountID,
		&media.Domain,
		&media.Kind,
		&media.StorageBackend,
		&media.Bucket,
		&media.ObjectKey,
		&media.MimeType,
		&media.SizeBytes,
		&media.ChecksumSHA256,
		&media.Width,
		&media.Height,
		&media.DurationMS,
		&media.Visibility,
		&media.Status,
		&media.CreatedAt,
		&media.ExpiresAt,
		&media.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MediaObject{}, ErrNotFound
		}
		return domain.MediaObject{}, fmt.Errorf("failed to get media object by id: %w", err)
	}
	return media, nil
}

func (s *Store) FindActiveMediaByChecksum(ctx context.Context, ownerAccountID string, checksumSHA256 string, domainName domain.MediaDomain, kind domain.MediaKind) (domain.MediaObject, error) {
	var media domain.MediaObject
	err := s.pool.QueryRow(ctx, `
		SELECT
			id,
			owner_account_id,
			domain,
			kind,
			storage_backend,
			bucket,
			object_key,
			mime_type,
			size_bytes,
			checksum_sha256,
			width,
			height,
			duration_ms,
			visibility,
			status,
			created_at,
			expires_at,
			deleted_at
		FROM media_objects
		WHERE owner_account_id = $1
		  AND checksum_sha256 = $2
		  AND domain = $3
		  AND kind = $4
		  AND deleted_at IS NULL
		  AND status = 'active'
		ORDER BY created_at DESC
		LIMIT 1
	`, ownerAccountID, checksumSHA256, domainName, kind).Scan(
		&media.ID,
		&media.OwnerAccountID,
		&media.Domain,
		&media.Kind,
		&media.StorageBackend,
		&media.Bucket,
		&media.ObjectKey,
		&media.MimeType,
		&media.SizeBytes,
		&media.ChecksumSHA256,
		&media.Width,
		&media.Height,
		&media.DurationMS,
		&media.Visibility,
		&media.Status,
		&media.CreatedAt,
		&media.ExpiresAt,
		&media.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.MediaObject{}, ErrNotFound
		}
		return domain.MediaObject{}, fmt.Errorf("failed to find media by checksum: %w", err)
	}
	return media, nil
}

func (s *Store) ListMediaByOwner(ctx context.Context, ownerAccountID string, domainName *domain.MediaDomain, kind *domain.MediaKind, limit int) ([]domain.MediaObject, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	query := `
		SELECT
			id,
			owner_account_id,
			domain,
			kind,
			storage_backend,
			bucket,
			object_key,
			mime_type,
			size_bytes,
			checksum_sha256,
			width,
			height,
			duration_ms,
			visibility,
			status,
			created_at,
			expires_at,
			deleted_at
		FROM media_objects
		WHERE owner_account_id = $1
		  AND deleted_at IS NULL
	`
	args := []any{ownerAccountID}
	argIdx := 2
	if domainName != nil {
		query += fmt.Sprintf(" AND domain = $%d", argIdx)
		args = append(args, *domainName)
		argIdx++
	}
	if kind != nil {
		query += fmt.Sprintf(" AND kind = $%d", argIdx)
		args = append(args, *kind)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list media by owner: %w", err)
	}
	defer rows.Close()

	result := make([]domain.MediaObject, 0, limit)
	for rows.Next() {
		var media domain.MediaObject
		if scanErr := rows.Scan(
			&media.ID,
			&media.OwnerAccountID,
			&media.Domain,
			&media.Kind,
			&media.StorageBackend,
			&media.Bucket,
			&media.ObjectKey,
			&media.MimeType,
			&media.SizeBytes,
			&media.ChecksumSHA256,
			&media.Width,
			&media.Height,
			&media.DurationMS,
			&media.Visibility,
			&media.Status,
			&media.CreatedAt,
			&media.ExpiresAt,
			&media.DeletedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan media row: %w", scanErr)
		}
		result = append(result, media)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate media rows: %w", err)
	}
	return result, nil
}

func (s *Store) SoftDeleteMediaObject(ctx context.Context, mediaID string, ownerAccountID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE media_objects
		SET
			status = 'deleted',
			deleted_at = NOW()
		WHERE id = $1
		  AND owner_account_id = $2
		  AND deleted_at IS NULL
	`, mediaID, ownerAccountID)
	if err != nil {
		return false, fmt.Errorf("failed to soft delete media object: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) CountActiveMediaSizeByOwner(ctx context.Context, ownerAccountID string) (int64, error) {
	var total int64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(size_bytes), 0)
		FROM media_objects
		WHERE owner_account_id = $1
		  AND deleted_at IS NULL
		  AND status = 'active'
	`, ownerAccountID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("failed to count active media size by owner: %w", err)
	}
	return total, nil
}

func (s *Store) CountMediaByOwner(ctx context.Context, ownerAccountID string, domainName *domain.MediaDomain, kinds []domain.MediaKind) (int64, error) {
	query := `
		SELECT COUNT(*)
		FROM media_objects
		WHERE owner_account_id = $1
		  AND deleted_at IS NULL
		  AND status = 'active'
	`
	args := []any{ownerAccountID}
	argIdx := 2
	if domainName != nil {
		query += fmt.Sprintf(" AND domain = $%d", argIdx)
		args = append(args, *domainName)
		argIdx++
	}
	if len(kinds) > 0 {
		query += fmt.Sprintf(" AND kind = ANY($%d)", argIdx)
		values := make([]string, 0, len(kinds))
		for _, kind := range kinds {
			values = append(values, string(kind))
		}
		args = append(args, values)
		argIdx++
	}

	var count int64
	err := s.pool.QueryRow(ctx, query, args...).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count media by owner: %w", err)
	}
	return count, nil
}

func (s *Store) UpsertMediaVariant(ctx context.Context, variant domain.MediaVariant) (domain.MediaVariant, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO media_variants (
			media_id,
			variant_type,
			object_key,
			width,
			height,
			size_bytes
		)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (media_id, variant_type) DO UPDATE SET
			object_key = EXCLUDED.object_key,
			width = EXCLUDED.width,
			height = EXCLUDED.height,
			size_bytes = EXCLUDED.size_bytes
		RETURNING media_id, variant_type
	`, variant.MediaID, variant.VariantType, variant.ObjectKey, variant.Width, variant.Height, variant.SizeBytes).Scan(
		&variant.MediaID,
		&variant.VariantType,
	)
	if err != nil {
		return domain.MediaVariant{}, fmt.Errorf("failed to upsert media variant: %w", err)
	}
	return variant, nil
}

func (s *Store) ListMediaVariants(ctx context.Context, mediaID string) ([]domain.MediaVariant, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT media_id, variant_type, object_key, width, height, size_bytes
		FROM media_variants
		WHERE media_id = $1
		ORDER BY variant_type ASC
	`, mediaID)
	if err != nil {
		return nil, fmt.Errorf("failed to list media variants: %w", err)
	}
	defer rows.Close()

	result := make([]domain.MediaVariant, 0, 3)
	for rows.Next() {
		var variant domain.MediaVariant
		if scanErr := rows.Scan(
			&variant.MediaID,
			&variant.VariantType,
			&variant.ObjectKey,
			&variant.Width,
			&variant.Height,
			&variant.SizeBytes,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan media variant row: %w", scanErr)
		}
		result = append(result, variant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate media variant rows: %w", err)
	}
	return result, nil
}

func (s *Store) ListExpiredMedia(ctx context.Context, before time.Time, limit int) ([]domain.MediaObject, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			id,
			owner_account_id,
			domain,
			kind,
			storage_backend,
			bucket,
			object_key,
			mime_type,
			size_bytes,
			checksum_sha256,
			width,
			height,
			duration_ms,
			visibility,
			status,
			created_at,
			expires_at,
			deleted_at
		FROM media_objects
		WHERE expires_at IS NOT NULL
		  AND expires_at < $1
		  AND deleted_at IS NULL
		ORDER BY expires_at ASC
		LIMIT $2
	`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list expired media: %w", err)
	}
	defer rows.Close()

	result := make([]domain.MediaObject, 0, limit)
	for rows.Next() {
		var media domain.MediaObject
		if scanErr := rows.Scan(
			&media.ID,
			&media.OwnerAccountID,
			&media.Domain,
			&media.Kind,
			&media.StorageBackend,
			&media.Bucket,
			&media.ObjectKey,
			&media.MimeType,
			&media.SizeBytes,
			&media.ChecksumSHA256,
			&media.Width,
			&media.Height,
			&media.DurationMS,
			&media.Visibility,
			&media.Status,
			&media.CreatedAt,
			&media.ExpiresAt,
			&media.DeletedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan expired media row: %w", scanErr)
		}
		result = append(result, media)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate expired media rows: %w", err)
	}
	return result, nil
}

func (s *Store) MarkMediaExpired(ctx context.Context, mediaID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE media_objects
		SET
			status = 'expired',
			deleted_at = COALESCE(deleted_at, NOW())
		WHERE id = $1
	`, mediaID)
	if err != nil {
		return fmt.Errorf("failed to mark media expired: %w", err)
	}
	return nil
}
