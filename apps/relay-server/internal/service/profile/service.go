package profile

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
)

const (
	maxDisplayNameLength = 64
	maxBioLength         = 500
	maxStatusLength      = 120
	maxLocationLength    = 120
	maxWebsiteLength     = 256
	minUsernameLength    = 3
	maxUsernameLength    = 24
	usernameCooldown     = 14 * 24 * time.Hour
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{1,22}[a-z0-9])?$`)

type Service struct {
	repo          *postgres.Store
	privacyPolicy *privacy.Service
}

type UpdateInput struct {
	DisplayName   *string
	Username      *string
	Bio           *string
	StatusText    *string
	BirthDate     *time.Time
	BirthDateSet  bool
	Location      *string
	WebsiteURL    *string
	AvatarMediaID *string
	BannerMediaID *string
}

func New(repo *postgres.Store, privacyPolicy *privacy.Service) *Service {
	return &Service{
		repo:          repo,
		privacyPolicy: privacyPolicy,
	}
}

func (s *Service) GetMyProfile(ctx context.Context, principal auth.AuthPrincipal) (domain.UserPublicProfile, error) {
	return s.GetProfileByAccountID(ctx, principal, principal.AccountID)
}

func (s *Service) GetProfileByUsername(ctx context.Context, principal auth.AuthPrincipal, username string) (domain.UserPublicProfile, error) {
	trimmed := strings.TrimSpace(username)
	if trimmed == "" {
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeValidation, "username is required")
	}
	profile, err := s.repo.GetUserProfileByUsername(ctx, trimmed)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeNotFound, "profile not found")
		}
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to resolve profile")
	}
	return s.GetProfileByAccountID(ctx, principal, profile.AccountID)
}

func (s *Service) SearchProfiles(ctx context.Context, principal auth.AuthPrincipal, query string, limit int) ([]domain.UserSearchItem, error) {
	trimmed := strings.TrimSpace(query)
	if len(trimmed) < 2 {
		return []domain.UserSearchItem{}, nil
	}
	items, err := s.repo.SearchUserProfiles(ctx, trimmed, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to search profiles")
	}
	filtered := make([]domain.UserSearchItem, 0, len(items))
	for _, item := range items {
		if item.AccountID == principal.AccountID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered, nil
}

func (s *Service) GetProfileByAccountID(ctx context.Context, principal auth.AuthPrincipal, accountID string) (domain.UserPublicProfile, error) {
	targetAccountID := strings.TrimSpace(accountID)
	if targetAccountID == "" {
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeValidation, "account id is required")
	}

	account, err := s.repo.GetAccountByID(ctx, targetAccountID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeNotFound, "account not found")
		}
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to resolve account")
	}

	profile, err := s.repo.GetUserProfileByAccountID(ctx, targetAccountID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeNotFound, "profile not found")
		}
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to resolve profile")
	}

	settings, err := s.privacyPolicy.GetSettings(ctx, targetAccountID)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}

	friendState, err := s.resolveFriendState(ctx, principal.AccountID, targetAccountID)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}

	canViewProfile, err := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.ProfileVisibility)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	if !canViewProfile {
		return domain.UserPublicProfile{
			AccountID:            targetAccountID,
			DisplayName:          profile.DisplayName,
			Username:             profile.Username,
			AvatarMediaID:        profile.AvatarMediaID,
			CreatedAt:            account.CreatedAt,
			FriendState:          friendState,
			Privacy:              settings,
			CanStartDirectChat:   false,
			CanSendFriendRequest: false,
			CanViewPosts:         false,
			CanViewPhotos:        false,
			CanViewStories:       false,
			CanViewFriends:       false,
		}, nil
	}

	canViewPosts, err := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.PostsVisibility)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	canViewPhotos, err := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.PhotosVisibility)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	canViewStories, err := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.StoriesVisibility)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	canViewFriends, err := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.FriendsVisibility)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	canSendFriendRequest, err := s.privacyPolicy.CanSendFriendRequest(ctx, targetAccountID, principal.AccountID, settings)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}
	canStartDirect, err := s.privacyPolicy.CanStartDirect(ctx, targetAccountID, principal.AccountID, settings)
	if err != nil {
		return domain.UserPublicProfile{}, err
	}

	postCount := int64(0)
	if canViewPosts {
		postCount, _ = s.repo.CountSocialPostsByAuthor(ctx, targetAccountID)
	}
	photoCount := int64(0)
	if canViewPhotos {
		domainSocial := domain.MediaDomainSocial
		photoCount, _ = s.repo.CountMediaByOwner(ctx, targetAccountID, &domainSocial, []domain.MediaKind{domain.MediaKindPhoto, domain.MediaKindVideo})
	}
	friendCount := int64(0)
	if canViewFriends {
		friendCount, _ = s.repo.CountFriends(ctx, targetAccountID)
	}

	var existingDirectConversationID *string
	if canStartDirect && principal.AccountID != targetAccountID {
		direct, directErr := s.repo.FindDirectConversationByPair(ctx, principal.AccountID, targetAccountID)
		if directErr == nil {
			existingDirectConversationID = &direct.ID
		} else if directErr != postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to resolve direct conversation state")
		}
	}

	result := domain.UserPublicProfile{
		AccountID:                  account.ID,
		Email:                      account.Email,
		DisplayName:                profile.DisplayName,
		Username:                   profile.Username,
		Bio:                        profile.Bio,
		StatusText:                 profile.StatusText,
		BirthDate:                  profile.BirthDate,
		Location:                   profile.Location,
		WebsiteURL:                 profile.WebsiteURL,
		AvatarMediaID:              profile.AvatarMediaID,
		BannerMediaID:              profile.BannerMediaID,
		FriendState:                friendState,
		Privacy:                    settings,
		CreatedAt:                  account.CreatedAt,
		PostCount:                  postCount,
		PhotoCount:                 photoCount,
		FriendCount:                friendCount,
		CanStartDirectChat:         canStartDirect && principal.AccountID != targetAccountID,
		ExistingDirectConversation: existingDirectConversationID,
		CanViewPosts:               canViewPosts,
		CanViewPhotos:              canViewPhotos,
		CanViewStories:             canViewStories,
		CanViewFriends:             canViewFriends,
		CanSendFriendRequest:       canSendFriendRequest && principal.AccountID != targetAccountID && friendState == domain.FriendRelationNone,
	}

	if visible, visErr := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.BirthDateVisibility); visErr == nil && !visible {
		result.BirthDate = nil
	}
	if visible, visErr := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.LocationVisibility); visErr == nil && !visible {
		result.Location = nil
	}
	if visible, visErr := s.privacyPolicy.CanView(ctx, targetAccountID, principal.AccountID, settings.LinksVisibility); visErr == nil && !visible {
		result.WebsiteURL = nil
	}

	return result, nil
}

func (s *Service) UpdateProfile(ctx context.Context, principal auth.AuthPrincipal, input UpdateInput) (domain.UserProfile, error) {
	current, err := s.repo.GetUserProfileByAccountID(ctx, principal.AccountID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeNotFound, "profile not found")
		}
		return domain.UserProfile{}, service.NewError(service.ErrorCodeInternal, "failed to load profile")
	}

	if input.DisplayName != nil {
		displayName := strings.TrimSpace(*input.DisplayName)
		if len(displayName) == 0 || len(displayName) > maxDisplayNameLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "display name length is invalid")
		}
		current.DisplayName = displayName
	}

	if input.Username != nil {
		normalizedUsername := strings.ToLower(strings.TrimSpace(*input.Username))
		if len(normalizedUsername) < minUsernameLength || len(normalizedUsername) > maxUsernameLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "username length is invalid")
		}
		if !usernamePattern.MatchString(normalizedUsername) {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "username contains unsupported symbols")
		}
		if !strings.EqualFold(current.Username, normalizedUsername) {
			if current.UsernameChangedAt != nil {
				nextAllowedAt := current.UsernameChangedAt.Add(usernameCooldown)
				if time.Now().UTC().Before(nextAllowedAt) {
					return domain.UserProfile{}, service.NewErrorWithDetails(service.ErrorCodeValidation, "username can be changed once every 14 days", map[string]any{
						"nextAllowedAt": nextAllowedAt.UTC().Format(time.RFC3339),
					})
				}
			}
			current.Username = normalizedUsername
			now := time.Now().UTC()
			current.UsernameChangedAt = &now
		}
	}

	if input.Bio != nil {
		bio := strings.TrimSpace(*input.Bio)
		if len(bio) > maxBioLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "bio is too long")
		}
		current.Bio = bio
	}

	if input.StatusText != nil {
		statusText := strings.TrimSpace(*input.StatusText)
		if len(statusText) > maxStatusLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "status text is too long")
		}
		current.StatusText = statusText
	}

	if input.BirthDateSet {
		current.BirthDate = input.BirthDate
	}

	if input.Location != nil {
		location := strings.TrimSpace(*input.Location)
		if len(location) > maxLocationLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "location is too long")
		}
		if location == "" {
			current.Location = nil
		} else {
			current.Location = &location
		}
	}

	if input.WebsiteURL != nil {
		url := strings.TrimSpace(*input.WebsiteURL)
		if len(url) > maxWebsiteLength {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "website url is too long")
		}
		if url == "" {
			current.WebsiteURL = nil
		} else {
			current.WebsiteURL = &url
		}
	}

	if input.AvatarMediaID != nil {
		trimmed := strings.TrimSpace(*input.AvatarMediaID)
		if trimmed == "" {
			current.AvatarMediaID = nil
		} else {
			current.AvatarMediaID = &trimmed
		}
	}

	if input.BannerMediaID != nil {
		trimmed := strings.TrimSpace(*input.BannerMediaID)
		if trimmed == "" {
			current.BannerMediaID = nil
		} else {
			current.BannerMediaID = &trimmed
		}
	}

	updated, err := s.repo.UpdateUserProfile(ctx, current)
	if err != nil {
		if err == postgres.ErrDuplicateUsername {
			return domain.UserProfile{}, service.NewError(service.ErrorCodeValidation, "username already taken")
		}
		return domain.UserProfile{}, service.NewError(service.ErrorCodeInternal, "failed to update profile")
	}
	return updated, nil
}

func (s *Service) resolveFriendState(ctx context.Context, viewerAccountID string, targetAccountID string) (domain.FriendRelationState, error) {
	if viewerAccountID == targetAccountID {
		return domain.FriendRelationFriends, nil
	}
	blockedByViewer, err := s.repo.IsBlocked(ctx, viewerAccountID, targetAccountID)
	if err != nil {
		return domain.FriendRelationNone, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	}
	blockedByTarget, err := s.repo.IsBlocked(ctx, targetAccountID, viewerAccountID)
	if err != nil {
		return domain.FriendRelationNone, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	}
	if blockedByViewer || blockedByTarget {
		return domain.FriendRelationBlocked, nil
	}

	areFriends, err := s.repo.AreFriends(ctx, viewerAccountID, targetAccountID)
	if err != nil {
		return domain.FriendRelationNone, service.NewError(service.ErrorCodeInternal, "failed to resolve friendship state")
	}
	if areFriends {
		return domain.FriendRelationFriends, nil
	}

	request, err := s.repo.FindActiveFriendRequestBetween(ctx, viewerAccountID, targetAccountID)
	if err == nil {
		if request.FromAccountID == viewerAccountID {
			return domain.FriendRelationOutgoing, nil
		}
		return domain.FriendRelationIncoming, nil
	}
	if err != postgres.ErrNotFound {
		return domain.FriendRelationNone, service.NewError(service.ErrorCodeInternal, "failed to resolve friend request state")
	}
	return domain.FriendRelationNone, nil
}
