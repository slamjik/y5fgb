package users

import (
	"context"
	"strings"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
)

type Service struct {
	repo *postgres.Store
}

type SearchInput struct {
	Query string
	Limit int
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func (s *Service) Search(ctx context.Context, principal auth.AuthPrincipal, input SearchInput) ([]domain.UserSearchItem, error) {
	query := strings.TrimSpace(input.Query)
	if len(query) < 2 {
		return []domain.UserSearchItem{}, nil
	}

	items, err := s.repo.SearchAccountsByEmail(ctx, query, input.Limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to search users")
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

func (s *Service) GetPublicProfile(ctx context.Context, principal auth.AuthPrincipal, accountID string) (domain.UserPublicProfile, error) {
	resolvedAccountID := strings.TrimSpace(accountID)
	if resolvedAccountID == "" {
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeValidation, "account id is required")
	}

	account, err := s.repo.GetAccountByID(ctx, resolvedAccountID)
	if err != nil {
		if err == postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeNotFound, "account not found")
		}
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to load account profile")
	}

	postCount, err := s.repo.CountSocialPostsByAuthor(ctx, resolvedAccountID)
	if err != nil {
		return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to load account activity")
	}

	canStartDirect := resolvedAccountID != principal.AccountID
	var existingDirectConversationID *string
	if canStartDirect {
		direct, directErr := s.repo.FindDirectConversationByPair(ctx, principal.AccountID, resolvedAccountID)
		if directErr == nil {
			existingDirectConversationID = &direct.ID
		} else if directErr != postgres.ErrNotFound {
			return domain.UserPublicProfile{}, service.NewError(service.ErrorCodeInternal, "failed to load direct conversation state")
		}
	}

	return domain.UserPublicProfile{
		AccountID:                  account.ID,
		Email:                      account.Email,
		CreatedAt:                  account.CreatedAt,
		PostCount:                  postCount,
		CanStartDirectChat:         canStartDirect,
		ExistingDirectConversation: existingDirectConversationID,
	}, nil
}
