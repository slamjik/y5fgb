package stories

import (
	"context"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
)

const maxStoryCaptionLength = 280

type Service struct {
	repo    *postgres.Store
	cfg     config.MediaConfig
	privacy *privacy.Service
}

type CreateInput struct {
	MediaID    string
	Caption    *string
	Visibility *domain.VisibilityScope
}

func New(repo *postgres.Store, cfg config.MediaConfig, privacyPolicy *privacy.Service) *Service {
	return &Service{
		repo:    repo,
		cfg:     cfg,
		privacy: privacyPolicy,
	}
}

func (s *Service) Create(ctx context.Context, principal auth.AuthPrincipal, input CreateInput) (domain.StoryFeedItem, error) {
	mediaID := strings.TrimSpace(input.MediaID)
	if mediaID == "" {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeValidation, "media id is required")
	}
	media, err := s.repo.GetMediaObjectByID(ctx, mediaID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeNotFound, "media not found")
		}
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to load media")
	}
	if media.OwnerAccountID != principal.AccountID {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeForbidden, "story media must belong to current account")
	}
	if media.Domain != domain.MediaDomainStory {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeValidation, "media domain must be story")
	}
	if media.Kind != domain.MediaKindStoryImage && media.Kind != domain.MediaKindStoryVideo {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeValidation, "invalid story media kind")
	}

	caption := ""
	if input.Caption != nil {
		caption = strings.TrimSpace(*input.Caption)
	}
	if len(caption) > maxStoryCaptionLength {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeValidation, "story caption is too long")
	}

	visibility := domain.VisibilityFriends
	if input.Visibility != nil {
		visibility = *input.Visibility
	}
	if visibility != domain.VisibilityEveryone && visibility != domain.VisibilityFriends && visibility != domain.VisibilityOnlyMe {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeValidation, "invalid story visibility")
	}

	expiresAt := time.Now().UTC().Add(s.cfg.StoryTTL)
	if media.ExpiresAt != nil && media.ExpiresAt.Before(expiresAt) {
		expiresAt = media.ExpiresAt.UTC()
	}

	createdStory, err := s.repo.CreateStory(ctx, domain.Story{
		ID:             security.NewID(),
		OwnerAccountID: principal.AccountID,
		MediaID:        media.ID,
		Caption:        caption,
		Visibility:     visibility,
		ExpiresAt:      expiresAt,
		CreatedAt:      time.Now().UTC(),
	})
	if err != nil {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to create story")
	}
	profile, profileErr := s.repo.GetUserProfileByAccountID(ctx, principal.AccountID)
	if profileErr != nil {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to resolve story owner profile")
	}
	return domain.StoryFeedItem{
		Story:       createdStory,
		OwnerName:   profile.DisplayName,
		OwnerUser:   profile.Username,
		OwnerAvatar: profile.AvatarMediaID,
		Media:       &media,
	}, nil
}

func (s *Service) Feed(ctx context.Context, principal auth.AuthPrincipal, limit int) ([]domain.StoryFeedItem, error) {
	items, err := s.repo.ListStoryFeed(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load story feed")
	}
	filtered := make([]domain.StoryFeedItem, 0, len(items))
	for _, item := range items {
		blockedByViewer, blockErr := s.repo.IsBlocked(ctx, principal.AccountID, item.Story.OwnerAccountID)
		if blockErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
		}
		blockedByOwner, blockErr := s.repo.IsBlocked(ctx, item.Story.OwnerAccountID, principal.AccountID)
		if blockErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
		}
		if blockedByViewer || blockedByOwner {
			continue
		}
		canView, visErr := s.privacy.CanView(ctx, item.Story.OwnerAccountID, principal.AccountID, item.Story.Visibility)
		if visErr != nil {
			return nil, visErr
		}
		if !canView {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered, nil
}

func (s *Service) GetByID(ctx context.Context, principal auth.AuthPrincipal, storyID string) (domain.StoryFeedItem, error) {
	story, err := s.repo.GetStoryByID(ctx, strings.TrimSpace(storyID))
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeNotFound, "story not found")
		}
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to load story")
	}
	if story.DeletedAt != nil || story.ExpiresAt.Before(time.Now().UTC()) {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeNotFound, "story not found")
	}
	canView, visErr := s.privacy.CanView(ctx, story.OwnerAccountID, principal.AccountID, story.Visibility)
	if visErr != nil {
		return domain.StoryFeedItem{}, visErr
	}
	if !canView {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeForbidden, "story access denied")
	}
	owner, ownerErr := s.repo.GetUserProfileByAccountID(ctx, story.OwnerAccountID)
	if ownerErr != nil {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to resolve story owner")
	}
	media, mediaErr := s.repo.GetMediaObjectByID(ctx, story.MediaID)
	if mediaErr != nil {
		return domain.StoryFeedItem{}, service.NewError(service.ErrorCodeInternal, "failed to resolve story media")
	}
	return domain.StoryFeedItem{
		Story:       story,
		OwnerName:   owner.DisplayName,
		OwnerUser:   owner.Username,
		OwnerAvatar: owner.AvatarMediaID,
		Media:       &media,
	}, nil
}

func (s *Service) Delete(ctx context.Context, principal auth.AuthPrincipal, storyID string) error {
	ok, err := s.repo.SoftDeleteStory(ctx, strings.TrimSpace(storyID), principal.AccountID)
	if err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to delete story")
	}
	if !ok {
		return service.NewError(service.ErrorCodeNotFound, "story not found")
	}
	return nil
}
