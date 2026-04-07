package privacy

import (
	"context"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
)

type Service struct {
	repo *postgres.Store
}

type UpdateInput struct {
	ProfileVisibility    *domain.VisibilityScope
	PostsVisibility      *domain.VisibilityScope
	PhotosVisibility     *domain.VisibilityScope
	StoriesVisibility    *domain.VisibilityScope
	FriendsVisibility    *domain.VisibilityScope
	BirthDateVisibility  *domain.VisibilityScope
	LocationVisibility   *domain.VisibilityScope
	LinksVisibility      *domain.VisibilityScope
	FriendRequestsPolicy *domain.FriendRequestPolicy
	DMPolicy             *domain.DMPolicy
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func DefaultSettings(accountID string) domain.ProfilePrivacySettings {
	return domain.ProfilePrivacySettings{
		AccountID:            accountID,
		ProfileVisibility:    domain.VisibilityEveryone,
		PostsVisibility:      domain.VisibilityFriends,
		PhotosVisibility:     domain.VisibilityFriends,
		StoriesVisibility:    domain.VisibilityFriends,
		FriendsVisibility:    domain.VisibilityFriends,
		BirthDateVisibility:  domain.VisibilityFriends,
		LocationVisibility:   domain.VisibilityFriends,
		LinksVisibility:      domain.VisibilityFriends,
		FriendRequestsPolicy: domain.FriendRequestPolicyEveryone,
		DMPolicy:             domain.DMPolicyFriends,
		UpdatedAt:            time.Now().UTC(),
	}
}

func (s *Service) GetSettings(ctx context.Context, accountID string) (domain.ProfilePrivacySettings, error) {
	settings, err := s.repo.GetProfilePrivacySettings(ctx, accountID)
	if err == nil {
		return settings, nil
	}
	if err != postgres.ErrNotFound {
		return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeInternal, "failed to load privacy settings")
	}
	created, createErr := s.repo.UpsertProfilePrivacySettings(ctx, DefaultSettings(accountID))
	if createErr != nil {
		return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeInternal, "failed to create default privacy settings")
	}
	return created, nil
}

func (s *Service) UpdateSettings(ctx context.Context, accountID string, input UpdateInput) (domain.ProfilePrivacySettings, error) {
	current, err := s.GetSettings(ctx, accountID)
	if err != nil {
		return domain.ProfilePrivacySettings{}, err
	}
	if input.ProfileVisibility != nil {
		if !isValidVisibility(*input.ProfileVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid profile visibility")
		}
		current.ProfileVisibility = *input.ProfileVisibility
	}
	if input.PostsVisibility != nil {
		if !isValidVisibility(*input.PostsVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid posts visibility")
		}
		current.PostsVisibility = *input.PostsVisibility
	}
	if input.PhotosVisibility != nil {
		if !isValidVisibility(*input.PhotosVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid photos visibility")
		}
		current.PhotosVisibility = *input.PhotosVisibility
	}
	if input.StoriesVisibility != nil {
		if !isValidVisibility(*input.StoriesVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid stories visibility")
		}
		current.StoriesVisibility = *input.StoriesVisibility
	}
	if input.FriendsVisibility != nil {
		if !isValidVisibility(*input.FriendsVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid friends visibility")
		}
		current.FriendsVisibility = *input.FriendsVisibility
	}
	if input.BirthDateVisibility != nil {
		if !isValidVisibility(*input.BirthDateVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid birth date visibility")
		}
		current.BirthDateVisibility = *input.BirthDateVisibility
	}
	if input.LocationVisibility != nil {
		if !isValidVisibility(*input.LocationVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid location visibility")
		}
		current.LocationVisibility = *input.LocationVisibility
	}
	if input.LinksVisibility != nil {
		if !isValidVisibility(*input.LinksVisibility) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid links visibility")
		}
		current.LinksVisibility = *input.LinksVisibility
	}
	if input.FriendRequestsPolicy != nil {
		if !isValidFriendRequestPolicy(*input.FriendRequestsPolicy) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid friend requests policy")
		}
		current.FriendRequestsPolicy = *input.FriendRequestsPolicy
	}
	if input.DMPolicy != nil {
		if !isValidDMPolicy(*input.DMPolicy) {
			return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeValidation, "invalid dm policy")
		}
		current.DMPolicy = *input.DMPolicy
	}
	updated, updateErr := s.repo.UpsertProfilePrivacySettings(ctx, current)
	if updateErr != nil {
		return domain.ProfilePrivacySettings{}, service.NewError(service.ErrorCodeInternal, "failed to update privacy settings")
	}
	return updated, nil
}

func (s *Service) CanView(ctx context.Context, ownerAccountID string, viewerAccountID string, scope domain.VisibilityScope) (bool, error) {
	if strings.TrimSpace(ownerAccountID) == "" {
		return false, service.NewError(service.ErrorCodeValidation, "owner account id is required")
	}
	if ownerAccountID == viewerAccountID {
		return true, nil
	}
	switch scope {
	case domain.VisibilityEveryone:
		return true, nil
	case domain.VisibilityOnlyMe:
		return false, nil
	case domain.VisibilityFriends:
		areFriends, err := s.repo.AreFriends(ctx, ownerAccountID, viewerAccountID)
		if err != nil {
			return false, service.NewError(service.ErrorCodeInternal, "failed to resolve friendship state")
		}
		return areFriends, nil
	default:
		return false, service.NewError(service.ErrorCodeValidation, "invalid visibility scope")
	}
}

func (s *Service) CanSendFriendRequest(ctx context.Context, ownerAccountID string, viewerAccountID string, settings domain.ProfilePrivacySettings) (bool, error) {
	if ownerAccountID == viewerAccountID {
		return false, nil
	}
	switch settings.FriendRequestsPolicy {
	case domain.FriendRequestPolicyEveryone:
		return true, nil
	case domain.FriendRequestPolicyNobody:
		return false, nil
	case domain.FriendRequestPolicyFriends:
		areFriends, err := s.repo.AreFriends(ctx, ownerAccountID, viewerAccountID)
		if err != nil {
			return false, service.NewError(service.ErrorCodeInternal, "failed to resolve friendship state")
		}
		return areFriends, nil
	default:
		return false, service.NewError(service.ErrorCodeValidation, "invalid friend request policy")
	}
}

func (s *Service) CanStartDirect(ctx context.Context, ownerAccountID string, viewerAccountID string, settings domain.ProfilePrivacySettings) (bool, error) {
	if ownerAccountID == viewerAccountID {
		return true, nil
	}
	switch settings.DMPolicy {
	case domain.DMPolicyEveryone:
		return true, nil
	case domain.DMPolicyNobody:
		return false, nil
	case domain.DMPolicyFriends:
		areFriends, err := s.repo.AreFriends(ctx, ownerAccountID, viewerAccountID)
		if err != nil {
			return false, service.NewError(service.ErrorCodeInternal, "failed to resolve friendship state")
		}
		return areFriends, nil
	default:
		return false, service.NewError(service.ErrorCodeValidation, "invalid dm policy")
	}
}

func isValidVisibility(scope domain.VisibilityScope) bool {
	return scope == domain.VisibilityEveryone || scope == domain.VisibilityFriends || scope == domain.VisibilityOnlyMe
}

func isValidFriendRequestPolicy(policy domain.FriendRequestPolicy) bool {
	return policy == domain.FriendRequestPolicyEveryone || policy == domain.FriendRequestPolicyFriends || policy == domain.FriendRequestPolicyNobody
}

func isValidDMPolicy(policy domain.DMPolicy) bool {
	return policy == domain.DMPolicyEveryone || policy == domain.DMPolicyFriends || policy == domain.DMPolicyNobody
}
