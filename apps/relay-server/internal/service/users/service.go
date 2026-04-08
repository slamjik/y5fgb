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
	rawQuery := strings.TrimSpace(input.Query)
	query := normalizeUserQuery(rawQuery)
	if len(query) < 2 {
		return []domain.UserSearchItem{}, nil
	}

	profileItems, err := s.repo.SearchUserProfiles(ctx, query, input.Limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to search users")
	}

	result := make([]domain.UserSearchItem, 0, len(profileItems))
	seen := make(map[string]struct{}, len(profileItems))

	appendUnique := func(item domain.UserSearchItem) {
		if item.AccountID == principal.AccountID {
			return
		}
		if _, exists := seen[item.AccountID]; exists {
			return
		}
		seen[item.AccountID] = struct{}{}
		result = append(result, item)
	}

	for _, item := range profileItems {
		appendUnique(item)
	}

	return result, nil
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

	profile := domain.UserPublicProfile{
		AccountID:                  account.ID,
		CreatedAt:                  account.CreatedAt,
		PostCount:                  postCount,
		CanStartDirectChat:         canStartDirect,
		ExistingDirectConversation: existingDirectConversationID,
	}
	if principal.AccountID == resolvedAccountID {
		profile.Email = account.Email
	}
	return profile, nil
}

func normalizeUserQuery(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimLeft(trimmed, "@")
	return strings.TrimSpace(trimmed)
}
