package social

import (
	"context"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
)

const (
	maxPostContentLength = 4000
	maxMediaURLLength    = 2000
	maxMoodLength        = 64
	maxFeedLimit         = 100
)

type Service struct {
	repo          *postgres.Store
	privacyPolicy *privacy.Service
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
	MediaID   *string
	Mood      *string
}

func New(repo *postgres.Store, privacyPolicy *privacy.Service) *Service {
	return &Service{
		repo:          repo,
		privacyPolicy: privacyPolicy,
	}
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

	rawItems, err := s.repo.ListSocialPosts(ctx, postgres.ListSocialPostsParams{
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
	filtered := make([]domain.SocialPostFeedItem, 0, len(rawItems))
	for _, item := range rawItems {
		if item.Post.AuthorAccountID == principal.AccountID {
			filtered = append(filtered, item)
			continue
		}
		blockedByViewer, blockErr := s.repo.IsBlocked(ctx, principal.AccountID, item.Post.AuthorAccountID)
		if blockErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
		}
		blockedByAuthor, blockErr := s.repo.IsBlocked(ctx, item.Post.AuthorAccountID, principal.AccountID)
		if blockErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
		}
		if blockedByViewer || blockedByAuthor {
			continue
		}

		settings, settingsErr := s.privacyPolicy.GetSettings(ctx, item.Post.AuthorAccountID)
		if settingsErr != nil {
			return nil, settingsErr
		}
		canView, visibilityErr := s.privacyPolicy.CanView(ctx, item.Post.AuthorAccountID, principal.AccountID, settings.PostsVisibility)
		if visibilityErr != nil {
			return nil, visibilityErr
		}
		if !canView {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered, nil
}

func (s *Service) CreatePost(ctx context.Context, principal auth.AuthPrincipal, input CreatePostInput) (domain.SocialPostFeedItem, error) {
	content := strings.TrimSpace(input.Content)
	if content == "" {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeValidation, "post content is required")
	}
	if len(content) > maxPostContentLength {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeValidation, "post content is too long")
	}

	normalizedMediaType, normalizedMediaURL, normalizedMediaID, validationErr := s.normalizeMediaInput(ctx, principal, input.MediaType, input.MediaURL, input.MediaID)
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
		MediaID:         normalizedMediaID,
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
	profile, profileErr := s.repo.GetUserProfileByAccountID(ctx, principal.AccountID)
	if profileErr != nil && profileErr != postgres.ErrNotFound {
		return domain.SocialPostFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to resolve social post author profile")
	}

	var mediaObject *domain.MediaObject
	if created.MediaID != nil {
		if media, mediaErr := s.repo.GetMediaObjectByID(ctx, *created.MediaID); mediaErr == nil {
			mediaObject = &media
		}
	}

	return domain.SocialPostFeedItem{
		Post:              created,
		AuthorEmail:       account.Email,
		AuthorDisplayName: profile.DisplayName,
		AuthorUsername:    profile.Username,
		AuthorAvatarID:    profile.AvatarMediaID,
		Media:             mediaObject,
		LikeCount:         0,
		LikedByMe:         false,
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
	if err := s.ensurePostVisibleToViewer(ctx, principal, postID); err != nil {
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
	if err := s.ensurePostVisibleToViewer(ctx, principal, postID); err != nil {
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

func (s *Service) ensurePostVisibleToViewer(ctx context.Context, principal auth.AuthPrincipal, postID string) error {
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
	if post.AuthorAccountID == principal.AccountID {
		return nil
	}

	blockedByViewer, blockErr := s.repo.IsBlocked(ctx, principal.AccountID, post.AuthorAccountID)
	if blockErr != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	}
	blockedByAuthor, blockErr := s.repo.IsBlocked(ctx, post.AuthorAccountID, principal.AccountID)
	if blockErr != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	}
	if blockedByViewer || blockedByAuthor {
		return service.NewError(service.ErrorCodeForbidden, "social post is not visible")
	}

	settings, settingsErr := s.privacyPolicy.GetSettings(ctx, post.AuthorAccountID)
	if settingsErr != nil {
		return settingsErr
	}
	canView, visibilityErr := s.privacyPolicy.CanView(ctx, post.AuthorAccountID, principal.AccountID, settings.PostsVisibility)
	if visibilityErr != nil {
		return visibilityErr
	}
	if !canView {
		return service.NewError(service.ErrorCodeForbidden, "social post is not visible")
	}
	return nil
}

func (s *Service) normalizeMediaInput(ctx context.Context, principal auth.AuthPrincipal, mediaType *domain.SocialMediaType, mediaURL *string, mediaID *string) (*domain.SocialMediaType, *string, *string, error) {
	normalizedMediaID := normalizeOptionalText(mediaID)
	normalizedMediaURL := normalizeOptionalText(mediaURL)
	if normalizedMediaID != nil && normalizedMediaURL != nil {
		return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "use either mediaId or mediaUrl, not both")
	}
	if normalizedMediaID != nil {
		media, err := s.repo.GetMediaObjectByID(ctx, *normalizedMediaID)
		if err != nil {
			if err == postgres.ErrNotFound {
				return nil, nil, nil, service.NewError(service.ErrorCodeNotFound, "media not found")
			}
			return nil, nil, nil, service.NewError(service.ErrorCodeInternal, "failed to resolve media")
		}
		if media.OwnerAccountID != principal.AccountID {
			return nil, nil, nil, service.NewError(service.ErrorCodeForbidden, "media must belong to current account")
		}
		if media.Domain != domain.MediaDomainSocial {
			return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media domain must be social")
		}
		switch media.Kind {
		case domain.MediaKindPhoto:
			kind := domain.SocialMediaTypeImage
			return &kind, nil, normalizedMediaID, nil
		case domain.MediaKindVideo:
			kind := domain.SocialMediaTypeVideo
			return &kind, nil, normalizedMediaID, nil
		default:
			return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "unsupported social media kind")
		}
	}

	var normalizedURL *string
	if normalizedMediaURL != nil {
		trimmed := strings.TrimSpace(*normalizedMediaURL)
		if trimmed != "" {
			if len(trimmed) > maxMediaURLLength {
				return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media url is too long")
			}
			parsed, parseErr := url.Parse(trimmed)
			if parseErr != nil || parsed == nil || parsed.Host == "" || parsed.Scheme == "" {
				return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media url is invalid")
			}
			scheme := strings.ToLower(parsed.Scheme)
			if scheme != "http" && scheme != "https" {
				return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media url must use http/https")
			}
			if isRestrictedMediaHost(parsed.Hostname()) {
				return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media url host is not allowed")
			}
			normalized := parsed.String()
			normalizedURL = &normalized
		}
	}

	if normalizedURL == nil {
		return nil, nil, nil, nil
	}

	if mediaType == nil {
		return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media type is required when media url is set")
	}
	mediaTypeValue := domain.SocialMediaType(strings.ToLower(strings.TrimSpace(string(*mediaType))))
	if mediaTypeValue != domain.SocialMediaTypeImage && mediaTypeValue != domain.SocialMediaTypeVideo {
		return nil, nil, nil, service.NewError(service.ErrorCodeValidation, "media type must be image or video")
	}
	return &mediaTypeValue, normalizedURL, nil, nil
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

func isRestrictedMediaHost(hostname string) bool {
	host := strings.ToLower(strings.TrimSpace(hostname))
	if host == "" {
		return true
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	if addr.IsUnspecified() || addr.IsLoopback() || addr.IsMulticast() {
		return true
	}
	if addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
		return true
	}
	return false
}

func normalizeOptionalText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
