package social

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
)

const (
	maxPostContentLength = 4000
	maxMediaURLLength    = 2000
	maxMoodLength        = 64
	maxFeedLimit         = 100
)

type Service struct {
	repo *postgres.Store
}

type ListPostsInput struct {
	Offset    int
	Limit     int
	MediaType *domain.SocialMediaType
	Query     string
	OnlyMine  bool
}

type CreatePostInput struct {
	Content   string
	MediaType *domain.SocialMediaType
	MediaURL  *string
	Mood      *string
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListPosts(ctx context.Context, principal auth.AuthPrincipal, input ListPostsInput) ([]domain.SocialPostFeedItem, error) {
	limit := input.Limit
	if limit <= 0 || limit > maxFeedLimit {
		limit = 20
	}
	offset := max(input.Offset, 0)

	var onlyAuthor *string
	if input.OnlyMine {
		accountID := principal.AccountID
		onlyAuthor = &accountID
	}

	items, err := s.repo.ListSocialPosts(ctx, postgres.ListSocialPostsParams{
		ViewerAccountID:   principal.AccountID,
		Offset:            offset,
		Limit:             limit,
		MediaType:         input.MediaType,
		Query:             strings.TrimSpace(input.Query),
		OnlyAuthorAccount: onlyAuthor,
	})
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list social posts")
	}
	return items, nil
}

func (s *Service) CreatePost(ctx context.Context, principal auth.AuthPrincipal, input CreatePostInput) (domain.SocialPostFeedItem, error) {
	content := strings.TrimSpace(input.Content)
	if content == "" {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeValidation, "post content is required")
	}
	if len(content) > maxPostContentLength {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeValidation, "post content is too long")
	}

	normalizedMediaType, normalizedMediaURL, validationErr := normalizeMedia(input.MediaType, input.MediaURL)
	if validationErr != nil {
		return domain.SocialPostFeedItem{}, validationErr
	}

	mood, moodErr := normalizeMood(input.Mood)
	if moodErr != nil {
		return domain.SocialPostFeedItem{}, moodErr
	}

	now := time.Now().UTC()
	created, err := s.repo.CreateSocialPost(ctx, domain.SocialPost{
		ID:              security.NewID(),
		AuthorAccountID: principal.AccountID,
		Content:         content,
		MediaType:       normalizedMediaType,
		MediaURL:        normalizedMediaURL,
		Mood:            mood,
		CreatedAt:       now,
		UpdatedAt:       now,
	})
	if err != nil {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to create social post")
	}

	account, accountErr := s.repo.GetAccountByID(ctx, principal.AccountID)
	if accountErr != nil {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to resolve social post author")
	}

	return domain.SocialPostFeedItem{
		Post:        created,
		AuthorEmail: account.Email,
		LikeCount:   0,
		LikedByMe:   false,
	}, nil
}

func (s *Service) DeletePost(ctx context.Context, principal auth.AuthPrincipal, postID string) error {
	post, err := s.repo.GetSocialPostByID(ctx, postID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return service.NewError(service.ErrorCodeNotFound, "social post not found")
		}
		return service.NewError(service.ErrorCodeInternal, "failed to load social post")
	}
	if post.DeletedAt != nil {
		return service.NewError(service.ErrorCodeNotFound, "social post not found")
	}
	if post.AuthorAccountID != principal.AccountID {
		return service.NewError(service.ErrorCodeForbidden, "cannot delete social post authored by another account")
	}

	deleted, deleteErr := s.repo.SoftDeleteSocialPost(ctx, postID, principal.AccountID)
	if deleteErr != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to delete social post")
	}
	if !deleted {
		return service.NewError(service.ErrorCodeNotFound, "social post not found")
	}
	return nil
}

func (s *Service) LikePost(ctx context.Context, principal auth.AuthPrincipal, postID string) (int64, bool, error) {
	if err := s.ensurePostVisibleToViewer(ctx, postID); err != nil {
		return 0, false, err
	}
	if err := s.repo.UpsertSocialPostLike(ctx, domain.SocialPostLike{
		PostID:    postID,
		AccountID: principal.AccountID,
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		return 0, false, service.NewError(service.ErrorCodeInternal, "failed to like social post")
	}
	likeCount, likedByMe, countErr := s.repo.GetSocialPostLikeCountAndState(ctx, postID, principal.AccountID)
	if countErr != nil {
		return 0, false, service.NewError(service.ErrorCodeInternal, "failed to fetch social like state")
	}
	return likeCount, likedByMe, nil
}

func (s *Service) UnlikePost(ctx context.Context, principal auth.AuthPrincipal, postID string) (int64, bool, error) {
	if err := s.ensurePostVisibleToViewer(ctx, postID); err != nil {
		return 0, false, err
	}
	if err := s.repo.DeleteSocialPostLike(ctx, postID, principal.AccountID); err != nil {
		return 0, false, service.NewError(service.ErrorCodeInternal, "failed to unlike social post")
	}
	likeCount, likedByMe, countErr := s.repo.GetSocialPostLikeCountAndState(ctx, postID, principal.AccountID)
	if countErr != nil {
		return 0, false, service.NewError(service.ErrorCodeInternal, "failed to fetch social like state")
	}
	return likeCount, likedByMe, nil
}

func (s *Service) ListNotifications(ctx context.Context, principal auth.AuthPrincipal, limit int) ([]domain.SocialNotification, error) {
	if limit <= 0 || limit > maxFeedLimit {
		limit = 20
	}
	items, err := s.repo.ListSocialNotifications(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list social notifications")
	}
	return items, nil
}

func (s *Service) ensurePostVisibleToViewer(ctx context.Context, postID string) error {
	post, err := s.repo.GetSocialPostByID(ctx, postID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return service.NewError(service.ErrorCodeNotFound, "social post not found")
		}
		return service.NewError(service.ErrorCodeInternal, "failed to load social post")
	}
	if post.DeletedAt != nil {
		return service.NewError(service.ErrorCodeNotFound, "social post not found")
	}
	return nil
}

func normalizeMedia(mediaType *domain.SocialMediaType, mediaURL *string) (*domain.SocialMediaType, *string, error) {
	var normalizedURL *string
	if mediaURL != nil {
		trimmed := strings.TrimSpace(*mediaURL)
		if trimmed != "" {
			if len(trimmed) > maxMediaURLLength {
				return nil, nil, service.NewError(service.ErrorCodeValidation, "media url is too long")
			}
			parsed, parseErr := url.Parse(trimmed)
			if parseErr != nil || parsed == nil || parsed.Host == "" || parsed.Scheme == "" {
				return nil, nil, service.NewError(service.ErrorCodeValidation, "media url is invalid")
			}
			scheme := strings.ToLower(parsed.Scheme)
			if scheme != "http" && scheme != "https" {
				return nil, nil, service.NewError(service.ErrorCodeValidation, "media url must use http/https")
			}
			normalized := parsed.String()
			normalizedURL = &normalized
		}
	}

	if normalizedURL == nil {
		return nil, nil, nil
	}

	if mediaType == nil {
		return nil, nil, service.NewError(service.ErrorCodeValidation, "media type is required when media url is set")
	}
	mediaTypeValue := domain.SocialMediaType(strings.ToLower(strings.TrimSpace(string(*mediaType))))
	if mediaTypeValue != domain.SocialMediaTypeImage && mediaTypeValue != domain.SocialMediaTypeVideo {
		return nil, nil, service.NewError(service.ErrorCodeValidation, "media type must be image or video")
	}
	return &mediaTypeValue, normalizedURL, nil
}

func normalizeMood(mood *string) (*string, error) {
	if mood == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*mood)
	if trimmed == "" {
		return nil, nil
	}
	if len(trimmed) > maxMoodLength {
		return nil, service.NewError(service.ErrorCodeValidation, "mood is too long")
	}
	return &trimmed, nil
}
