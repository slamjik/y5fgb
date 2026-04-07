package friends

import (
	"context"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/privacy"
)

type Service struct {
	repo          *postgres.Store
	privacyPolicy *privacy.Service
}

func New(repo *postgres.Store, privacyPolicy *privacy.Service) *Service {
	return &Service{
		repo:          repo,
		privacyPolicy: privacyPolicy,
	}
}

func (s *Service) ListFriends(ctx context.Context, principal auth.AuthPrincipal, limit int) ([]domain.FriendListItem, error) {
	items, err := s.repo.ListFriends(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list friends")
	}
	return items, nil
}

func (s *Service) ListRequests(ctx context.Context, principal auth.AuthPrincipal, direction string, limit int) ([]domain.FriendRequestListItem, error) {
	items, err := s.repo.ListFriendRequests(ctx, principal.AccountID, direction, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list friend requests")
	}
	return items, nil
}

func (s *Service) SendRequest(ctx context.Context, principal auth.AuthPrincipal, targetAccountID string) (domain.FriendRequest, error) {
	target := strings.TrimSpace(targetAccountID)
	if target == "" {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "target account id is required")
	}
	if target == principal.AccountID {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "cannot send friend request to self")
	}

	if _, err := s.repo.GetAccountByID(ctx, target); err != nil {
		if err == postgres.ErrNotFound {
			return domain.FriendRequest{}, service.NewError(service.ErrorCodeNotFound, "target account not found")
		}
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to resolve target account")
	}

	if blocked, err := s.repo.IsBlocked(ctx, principal.AccountID, target); err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	} else if blocked {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "cannot send friend request to blocked account")
	}
	if blocked, err := s.repo.IsBlocked(ctx, target, principal.AccountID); err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to resolve block state")
	} else if blocked {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "target account does not accept requests")
	}

	areFriends, err := s.repo.AreFriends(ctx, principal.AccountID, target)
	if err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to resolve friendship state")
	}
	if areFriends {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "accounts are already friends")
	}

	if existing, err := s.repo.FindActiveFriendRequestBetween(ctx, principal.AccountID, target); err == nil {
		if existing.FromAccountID == principal.AccountID {
			return existing, nil
		}
		// Mirror pending request: accepting creates friendship immediately.
		accepted, acceptErr := s.AcceptRequest(ctx, principal, existing.ID)
		if acceptErr != nil {
			return domain.FriendRequest{}, acceptErr
		}
		return accepted, nil
	} else if err != postgres.ErrNotFound {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to resolve existing friend requests")
	}

	settings, err := s.privacyPolicy.GetSettings(ctx, target)
	if err != nil {
		return domain.FriendRequest{}, err
	}
	canSend, err := s.privacyPolicy.CanSendFriendRequest(ctx, target, principal.AccountID, settings)
	if err != nil {
		return domain.FriendRequest{}, err
	}
	if !canSend {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "target account does not accept friend requests")
	}

	created, err := s.repo.CreateFriendRequest(ctx, domain.FriendRequest{
		ID:            security.NewID(),
		FromAccountID: principal.AccountID,
		ToAccountID:   target,
		Status:        domain.FriendRequestStatusPending,
		CreatedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	})
	if err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to create friend request")
	}
	return created, nil
}

func (s *Service) AcceptRequest(ctx context.Context, principal auth.AuthPrincipal, requestID string) (domain.FriendRequest, error) {
	request, err := s.repo.GetFriendRequestByID(ctx, requestID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.FriendRequest{}, service.NewError(service.ErrorCodeNotFound, "friend request not found")
		}
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to load friend request")
	}
	if request.Status != domain.FriendRequestStatusPending {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "friend request is not pending")
	}
	if request.ToAccountID != principal.AccountID {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "cannot accept another account friend request")
	}

	actedBy := principal.AccountID
	updated, err := s.repo.UpdateFriendRequestStatus(ctx, request.ID, domain.FriendRequestStatusAccepted, &actedBy)
	if err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to accept friend request")
	}
	if err := s.repo.UpsertFriendship(ctx, request.FromAccountID, request.ToAccountID); err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to create friendship")
	}
	return updated, nil
}

func (s *Service) RejectRequest(ctx context.Context, principal auth.AuthPrincipal, requestID string) (domain.FriendRequest, error) {
	request, err := s.repo.GetFriendRequestByID(ctx, requestID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.FriendRequest{}, service.NewError(service.ErrorCodeNotFound, "friend request not found")
		}
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to load friend request")
	}
	if request.Status != domain.FriendRequestStatusPending {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "friend request is not pending")
	}
	if request.ToAccountID != principal.AccountID {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "cannot reject another account friend request")
	}
	actedBy := principal.AccountID
	updated, err := s.repo.UpdateFriendRequestStatus(ctx, request.ID, domain.FriendRequestStatusRejected, &actedBy)
	if err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to reject friend request")
	}
	return updated, nil
}

func (s *Service) CancelRequest(ctx context.Context, principal auth.AuthPrincipal, requestID string) (domain.FriendRequest, error) {
	request, err := s.repo.GetFriendRequestByID(ctx, requestID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.FriendRequest{}, service.NewError(service.ErrorCodeNotFound, "friend request not found")
		}
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to load friend request")
	}
	if request.Status != domain.FriendRequestStatusPending {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeValidation, "friend request is not pending")
	}
	if request.FromAccountID != principal.AccountID {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeForbidden, "cannot cancel another account friend request")
	}
	actedBy := principal.AccountID
	updated, err := s.repo.UpdateFriendRequestStatus(ctx, request.ID, domain.FriendRequestStatusCancelled, &actedBy)
	if err != nil {
		return domain.FriendRequest{}, service.NewError(service.ErrorCodeInternal, "failed to cancel friend request")
	}
	return updated, nil
}

func (s *Service) RemoveFriend(ctx context.Context, principal auth.AuthPrincipal, targetAccountID string) error {
	target := strings.TrimSpace(targetAccountID)
	if target == "" {
		return service.NewError(service.ErrorCodeValidation, "target account id is required")
	}
	if target == principal.AccountID {
		return service.NewError(service.ErrorCodeValidation, "cannot remove self")
	}
	if err := s.repo.DeleteFriendship(ctx, principal.AccountID, target); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to remove friendship")
	}
	return nil
}

func (s *Service) Block(ctx context.Context, principal auth.AuthPrincipal, targetAccountID string) error {
	target := strings.TrimSpace(targetAccountID)
	if target == "" {
		return service.NewError(service.ErrorCodeValidation, "target account id is required")
	}
	if target == principal.AccountID {
		return service.NewError(service.ErrorCodeValidation, "cannot block self")
	}
	if err := s.repo.UpsertBlock(ctx, principal.AccountID, target); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to block account")
	}
	_ = s.repo.DeletePendingFriendRequestsBetween(ctx, principal.AccountID, target)
	_ = s.repo.DeleteFriendship(ctx, principal.AccountID, target)
	return nil
}

func (s *Service) Unblock(ctx context.Context, principal auth.AuthPrincipal, targetAccountID string) error {
	target := strings.TrimSpace(targetAccountID)
	if target == "" {
		return service.NewError(service.ErrorCodeValidation, "target account id is required")
	}
	if err := s.repo.DeleteBlock(ctx, principal.AccountID, target); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to unblock account")
	}
	return nil
}
