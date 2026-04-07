package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

type ListSocialPostsParams struct {
	ViewerAccountID   string
	Offset            int
	Limit             int
	MediaType         *domain.SocialMediaType
	Query             string
	OnlyAuthorAccount *string
}

func (s *Store) CreateSocialPost(ctx context.Context, post domain.SocialPost) (domain.SocialPost, error) {
	if post.CreatedAt.IsZero() {
		post.CreatedAt = time.Now().UTC()
	}
	if post.UpdatedAt.IsZero() {
		post.UpdatedAt = post.CreatedAt
	}

	err := s.pool.QueryRow(ctx, `
		INSERT INTO social_posts (
			id,
			author_account_id,
			content,
			media_type,
			media_url,
			media_id,
			mood,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING created_at, updated_at
	`, post.ID, post.AuthorAccountID, post.Content, post.MediaType, post.MediaURL, post.MediaID, post.Mood, post.CreatedAt, post.UpdatedAt).Scan(
		&post.CreatedAt,
		&post.UpdatedAt,
	)
	if err != nil {
		return domain.SocialPost{}, fmt.Errorf("failed to create social post: %w", err)
	}
	return post, nil
}

func (s *Store) GetSocialPostByID(ctx context.Context, postID string) (domain.SocialPost, error) {
	var post domain.SocialPost
	var mediaType *string

	err := s.pool.QueryRow(ctx, `
		SELECT id, author_account_id, content, media_type, media_url, media_id, mood, created_at, updated_at, deleted_at
		FROM social_posts
		WHERE id = $1
	`, postID).Scan(
		&post.ID,
		&post.AuthorAccountID,
		&post.Content,
		&mediaType,
		&post.MediaURL,
		&post.MediaID,
		&post.Mood,
		&post.CreatedAt,
		&post.UpdatedAt,
		&post.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SocialPost{}, ErrNotFound
		}
		return domain.SocialPost{}, fmt.Errorf("failed to fetch social post: %w", err)
	}
	post.MediaType = mapSocialMediaType(mediaType)
	return post, nil
}

func (s *Store) SoftDeleteSocialPost(ctx context.Context, postID string, authorAccountID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE social_posts
		SET deleted_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
		  AND author_account_id = $2
		  AND deleted_at IS NULL
	`, postID, authorAccountID)
	if err != nil {
		return false, fmt.Errorf("failed to delete social post: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpsertSocialPostLike(ctx context.Context, like domain.SocialPostLike) error {
	if like.CreatedAt.IsZero() {
		like.CreatedAt = time.Now().UTC()
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO social_post_likes (post_id, account_id, created_at)
		VALUES ($1,$2,$3)
		ON CONFLICT (post_id, account_id) DO NOTHING
	`, like.PostID, like.AccountID, like.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to like social post: %w", err)
	}
	return nil
}

func (s *Store) DeleteSocialPostLike(ctx context.Context, postID string, accountID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM social_post_likes
		WHERE post_id = $1
		  AND account_id = $2
	`, postID, accountID)
	if err != nil {
		return fmt.Errorf("failed to unlike social post: %w", err)
	}
	return nil
}

func (s *Store) GetSocialPostLikeCountAndState(ctx context.Context, postID string, viewerAccountID string) (int64, bool, error) {
	var likeCount int64
	var likedByMe bool
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM social_post_likes WHERE post_id = $1) AS like_count,
			EXISTS (
				SELECT 1
				FROM social_post_likes
				WHERE post_id = $1
				  AND account_id = $2
			) AS liked_by_me
	`, postID, viewerAccountID).Scan(&likeCount, &likedByMe)
	if err != nil {
		return 0, false, fmt.Errorf("failed to load social like state: %w", err)
	}
	return likeCount, likedByMe, nil
}

func (s *Store) ListSocialPosts(ctx context.Context, params ListSocialPostsParams) ([]domain.SocialPostFeedItem, error) {
	limit := params.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	offset := max(params.Offset, 0)

	var conditions []string
	args := []any{params.ViewerAccountID}
	arg := 2

	conditions = append(conditions, "p.deleted_at IS NULL")

	if params.MediaType != nil {
		conditions = append(conditions, fmt.Sprintf("p.media_type = $%d", arg))
		args = append(args, string(*params.MediaType))
		arg++
	}

	queryText := strings.TrimSpace(params.Query)
	if queryText != "" {
		conditions = append(conditions, fmt.Sprintf("(p.content ILIKE $%d OR COALESCE(p.mood, '') ILIKE $%d)", arg, arg))
		args = append(args, "%"+queryText+"%")
		arg++
	}

	if params.OnlyAuthorAccount != nil && strings.TrimSpace(*params.OnlyAuthorAccount) != "" {
		conditions = append(conditions, fmt.Sprintf("p.author_account_id = $%d", arg))
		args = append(args, strings.TrimSpace(*params.OnlyAuthorAccount))
		arg++
	}

	whereClause := strings.Join(conditions, " AND ")
	query := fmt.Sprintf(`
		SELECT
			p.id,
			p.author_account_id,
			a.email,
			prof.display_name,
			prof.username,
			prof.avatar_media_id,
			p.content,
			p.media_type,
			p.media_url,
			p.media_id,
			p.mood,
			p.created_at,
			p.updated_at,
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
			mo.deleted_at,
			COALESCE(likes.like_count, 0) AS like_count,
			EXISTS (
				SELECT 1
				FROM social_post_likes l2
				WHERE l2.post_id = p.id
				  AND l2.account_id = $1
			) AS liked_by_me
		FROM social_posts p
		JOIN accounts a ON a.id = p.author_account_id
		LEFT JOIN user_profiles prof ON prof.account_id = p.author_account_id
		LEFT JOIN media_objects mo ON mo.id = p.media_id
		LEFT JOIN (
			SELECT post_id, COUNT(*)::BIGINT AS like_count
			FROM social_post_likes
			GROUP BY post_id
		) likes ON likes.post_id = p.id
		WHERE %s
		ORDER BY p.created_at DESC
		OFFSET $%d
		LIMIT $%d
	`, whereClause, arg, arg+1)

	args = append(args, offset, limit)
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list social posts: %w", err)
	}
	defer rows.Close()

	items := make([]domain.SocialPostFeedItem, 0, limit)
	for rows.Next() {
		var item domain.SocialPostFeedItem
		var mediaType *string
		var mediaID *string
		var mediaObjectID *string
		var mediaOwnerAccountID *string
		var mediaDomain *domain.MediaDomain
		var mediaKind *domain.MediaKind
		var mediaStorageBackend *domain.MediaStorageBackend
		var mediaBucket *string
		var mediaObjectKey *string
		var mediaMimeType *string
		var mediaSizeBytes *int64
		var mediaChecksum *string
		var mediaWidth *int
		var mediaHeight *int
		var mediaDurationMS *int64
		var mediaVisibility *domain.VisibilityScope
		var mediaStatus *domain.MediaStatus
		var mediaCreatedAt *time.Time
		var mediaExpiresAt *time.Time
		var mediaDeletedAt *time.Time
		if scanErr := rows.Scan(
			&item.Post.ID,
			&item.Post.AuthorAccountID,
			&item.AuthorEmail,
			&item.AuthorDisplayName,
			&item.AuthorUsername,
			&item.AuthorAvatarID,
			&item.Post.Content,
			&mediaType,
			&item.Post.MediaURL,
			&item.Post.MediaID,
			&item.Post.Mood,
			&item.Post.CreatedAt,
			&item.Post.UpdatedAt,
			&mediaObjectID,
			&mediaOwnerAccountID,
			&mediaDomain,
			&mediaKind,
			&mediaStorageBackend,
			&mediaBucket,
			&mediaObjectKey,
			&mediaMimeType,
			&mediaSizeBytes,
			&mediaChecksum,
			&mediaWidth,
			&mediaHeight,
			&mediaDurationMS,
			&mediaVisibility,
			&mediaStatus,
			&mediaCreatedAt,
			&mediaExpiresAt,
			&mediaDeletedAt,
			&item.LikeCount,
			&item.LikedByMe,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan social post row: %w", scanErr)
		}
		item.Post.MediaType = mapSocialMediaType(mediaType)
		mediaID = item.Post.MediaID
		if mediaID != nil && mediaObjectID != nil {
			media := domain.MediaObject{
				ID:             safeString(mediaObjectID),
				OwnerAccountID: safeString(mediaOwnerAccountID),
				Domain:         safeMediaDomain(mediaDomain),
				Kind:           safeMediaKind(mediaKind),
				StorageBackend: safeMediaBackend(mediaStorageBackend),
				Bucket:         mediaBucket,
				ObjectKey:      safeString(mediaObjectKey),
				MimeType:       safeString(mediaMimeType),
				SizeBytes:      safeInt64(mediaSizeBytes),
				ChecksumSHA256: safeString(mediaChecksum),
				Width:          mediaWidth,
				Height:         mediaHeight,
				DurationMS:     mediaDurationMS,
				Visibility:     safeVisibility(mediaVisibility),
				Status:         safeMediaStatus(mediaStatus),
				CreatedAt:      safeTime(mediaCreatedAt),
				ExpiresAt:      mediaExpiresAt,
				DeletedAt:      mediaDeletedAt,
			}
			item.Media = &media
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate social post rows: %w", err)
	}
	return items, nil
}

func (s *Store) ListSocialNotifications(ctx context.Context, authorAccountID string, limit int) ([]domain.SocialNotification, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			l.post_id,
			l.account_id,
			a.email,
			p.content,
			l.created_at
		FROM social_post_likes l
		JOIN social_posts p ON p.id = l.post_id
		JOIN accounts a ON a.id = l.account_id
		WHERE p.author_account_id = $1
		  AND l.account_id <> $1
		  AND p.deleted_at IS NULL
		ORDER BY l.created_at DESC
		LIMIT $2
	`, authorAccountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list social notifications: %w", err)
	}
	defer rows.Close()

	items := make([]domain.SocialNotification, 0, limit)
	for rows.Next() {
		var item domain.SocialNotification
		if scanErr := rows.Scan(
			&item.PostID,
			&item.ActorAccountID,
			&item.ActorEmail,
			&item.PostPreview,
			&item.CreatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan social notification row: %w", scanErr)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate social notification rows: %w", err)
	}
	return items, nil
}

func (s *Store) CountSocialPostsByAuthor(ctx context.Context, authorAccountID string) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM social_posts
		WHERE author_account_id = $1
		  AND deleted_at IS NULL
	`, authorAccountID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count social posts by author: %w", err)
	}
	return count, nil
}

func mapSocialMediaType(value *string) *domain.SocialMediaType {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	mapped := domain.SocialMediaType(trimmed)
	return &mapped
}

func safeString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func safeInt64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func safeTime(value *time.Time) time.Time {
	if value == nil {
		return time.Time{}
	}
	return *value
}

func safeVisibility(value *domain.VisibilityScope) domain.VisibilityScope {
	if value == nil {
		return domain.VisibilityFriends
	}
	return *value
}

func safeMediaDomain(value *domain.MediaDomain) domain.MediaDomain {
	if value == nil {
		return domain.MediaDomainSocial
	}
	return *value
}

func safeMediaKind(value *domain.MediaKind) domain.MediaKind {
	if value == nil {
		return domain.MediaKindPhoto
	}
	return *value
}

func safeMediaBackend(value *domain.MediaStorageBackend) domain.MediaStorageBackend {
	if value == nil {
		return domain.MediaStorageBackendLocal
	}
	return *value
}

func safeMediaStatus(value *domain.MediaStatus) domain.MediaStatus {
	if value == nil {
		return domain.MediaStatusActive
	}
	return *value
}
