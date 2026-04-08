package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateStory(ctx context.Context, story domain.Story) (domain.Story, error) {
	if story.CreatedAt.IsZero() {
		story.CreatedAt = time.Now().UTC()
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO stories (
			id,
			owner_account_id,
			media_id,
			caption,
			visibility,
			expires_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at
	`, story.ID, story.OwnerAccountID, story.MediaID, story.Caption, story.Visibility, story.ExpiresAt, story.CreatedAt).Scan(
		&story.CreatedAt,
	)
	if err != nil {
		return domain.Story{}, fmt.Errorf("failed to create story: %w", err)
	}
	return story, nil
}

func (s *Store) GetStoryByID(ctx context.Context, storyID string) (domain.Story, error) {
	var story domain.Story
	err := s.pool.QueryRow(ctx, `
		SELECT id, owner_account_id, media_id, caption, visibility, expires_at, created_at, deleted_at
		FROM stories
		WHERE id = $1
	`, storyID).Scan(
		&story.ID,
		&story.OwnerAccountID,
		&story.MediaID,
		&story.Caption,
		&story.Visibility,
		&story.ExpiresAt,
		&story.CreatedAt,
		&story.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Story{}, ErrNotFound
		}
		return domain.Story{}, fmt.Errorf("failed to get story by id: %w", err)
	}
	return story, nil
}

func (s *Store) SoftDeleteStory(ctx context.Context, storyID string, ownerAccountID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE stories
		SET deleted_at = NOW()
		WHERE id = $1
		  AND owner_account_id = $2
		  AND deleted_at IS NULL
	`, storyID, ownerAccountID)
	if err != nil {
		return false, fmt.Errorf("failed to soft delete story: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) ListStoryFeed(ctx context.Context, viewerAccountID string, limit int) ([]domain.StoryFeedItem, error) {
	if limit <= 0 || limit > 150 {
		limit = 60
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			st.id,
			st.owner_account_id,
			st.media_id,
			st.caption,
			st.visibility,
			st.expires_at,
			st.created_at,
			st.deleted_at,
			p.display_name,
			p.username,
			p.avatar_media_id,
			mo.id,
			mo.owner_account_id,
			mo.domain,
			mo.kind,
			mo.storage_backend,
			mo.bucket,
			mo.object_key,
			mo.mime_type,
			mo.size_bytes,
			mo.checksum_sha256,
			mo.width,
			mo.height,
			mo.duration_ms,
			mo.visibility,
			mo.status,
			mo.created_at,
			mo.expires_at,
			mo.deleted_at
		FROM stories st
		JOIN user_profiles p ON p.account_id = st.owner_account_id
		JOIN media_objects mo ON mo.id = st.media_id
		WHERE st.deleted_at IS NULL
		  AND st.expires_at > NOW()
		ORDER BY st.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list story feed: %w", err)
	}
	defer rows.Close()

	result := make([]domain.StoryFeedItem, 0, limit)
	for rows.Next() {
		var item domain.StoryFeedItem
		var media domain.MediaObject
		if scanErr := rows.Scan(
			&item.Story.ID,
			&item.Story.OwnerAccountID,
			&item.Story.MediaID,
			&item.Story.Caption,
			&item.Story.Visibility,
			&item.Story.ExpiresAt,
			&item.Story.CreatedAt,
			&item.Story.DeletedAt,
			&item.OwnerName,
			&item.OwnerUser,
			&item.OwnerAvatar,
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
			return nil, fmt.Errorf("failed to scan story feed row: %w", scanErr)
		}
		item.Media = &media
		if item.Story.OwnerAccountID == viewerAccountID {
			result = append(result, item)
			continue
		}
		// Visibility checks are enforced in service; repository returns base dataset.
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate story feed rows: %w", err)
	}
	return result, nil
}

func (s *Store) ListExpiredStories(ctx context.Context, before time.Time, limit int) ([]domain.Story, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, owner_account_id, media_id, caption, visibility, expires_at, created_at, deleted_at
		FROM stories
		WHERE expires_at < $1
		  AND deleted_at IS NULL
		ORDER BY expires_at ASC
		LIMIT $2
	`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list expired stories: %w", err)
	}
	defer rows.Close()

	result := make([]domain.Story, 0, limit)
	for rows.Next() {
		var story domain.Story
		if scanErr := rows.Scan(
			&story.ID,
			&story.OwnerAccountID,
			&story.MediaID,
			&story.Caption,
			&story.Visibility,
			&story.ExpiresAt,
			&story.CreatedAt,
			&story.DeletedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan expired story row: %w", scanErr)
		}
		result = append(result, story)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate expired story rows: %w", err)
	}
	return result, nil
}

func (s *Store) MarkStoryExpired(ctx context.Context, storyID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE stories
		SET deleted_at = COALESCE(deleted_at, NOW())
		WHERE id = $1
	`, storyID)
	if err != nil {
		return fmt.Errorf("failed to mark story expired: %w", err)
	}
	return nil
}

func (s *Store) ListFriendStoryNotifications(ctx context.Context, viewerAccountID string, limit int) ([]domain.StoryFeedItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			st.id,
			st.owner_account_id,
			st.media_id,
			st.caption,
			st.visibility,
			st.expires_at,
			st.created_at,
			st.deleted_at,
			p.display_name,
			p.username,
			p.avatar_media_id
		FROM stories st
		JOIN user_profiles p ON p.account_id = st.owner_account_id
		JOIN friendships f
		  ON (f.account_a_id = $1 AND f.account_b_id = st.owner_account_id)
		  OR (f.account_b_id = $1 AND f.account_a_id = st.owner_account_id)
		WHERE st.deleted_at IS NULL
		  AND st.expires_at > NOW()
		  AND st.owner_account_id <> $1
		ORDER BY st.created_at DESC
		LIMIT $2
	`, viewerAccountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list friend story notifications: %w", err)
	}
	defer rows.Close()

	result := make([]domain.StoryFeedItem, 0, limit)
	for rows.Next() {
		var item domain.StoryFeedItem
		if scanErr := rows.Scan(
			&item.Story.ID,
			&item.Story.OwnerAccountID,
			&item.Story.MediaID,
			&item.Story.Caption,
			&item.Story.Visibility,
			&item.Story.ExpiresAt,
			&item.Story.CreatedAt,
			&item.Story.DeletedAt,
			&item.OwnerName,
			&item.OwnerUser,
			&item.OwnerAvatar,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan friend story notification row: %w", scanErr)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate friend story notification rows: %w", err)
	}
	return result, nil
}
