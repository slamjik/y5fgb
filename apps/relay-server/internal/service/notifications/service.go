package notifications

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
)

type Service struct {
	repo *postgres.Store
}

type ListResult struct {
	Notifications []domain.AppNotification
	Total         int
	UnreadTotal   int
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, principal auth.AuthPrincipal, limit int) (ListResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	fetchLimit := limit * 3
	if fetchLimit < limit {
		fetchLimit = limit
	}
	if fetchLimit > 200 {
		fetchLimit = 200
	}

	state, err := s.repo.GetNotificationState(ctx, principal.AccountID)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load notification state")
	}

	notifications := make([]domain.AppNotification, 0, fetchLimit*2)

	likes, err := s.repo.ListSocialNotifications(ctx, principal.AccountID, fetchLimit)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load social notifications")
	}
	for _, like := range likes {
		actorName := like.ActorEmail
		actorUser := like.ActorEmail
		targetID := like.PostID
		preview := like.PostPreview
		actorID := like.ActorAccountID
		postID := like.PostID
		notifications = append(notifications, domain.AppNotification{
			ID:             fmt.Sprintf("social_like:%s:%s:%d", like.PostID, like.ActorAccountID, like.CreatedAt.UnixNano()),
			Type:           domain.NotificationTypeSocialLike,
			ActorAccountID: &actorID,
			ActorName:      &actorName,
			ActorUsername:  &actorUser,
			TargetID:       &targetID,
			Preview:        &preview,
			Navigation: &domain.NotificationNavigation{
				Target:    domain.NotificationNavigationTargetPost,
				AccountID: &actorID,
				PostID:    &postID,
			},
			CreatedAt: like.CreatedAt,
		})
	}

	incoming, err := s.repo.ListFriendRequests(ctx, principal.AccountID, "incoming", fetchLimit)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load friend request notifications")
	}
	for _, request := range incoming {
		targetID := request.Request.ID
		actorID := request.Actor.AccountID
		actorName := request.Actor.DisplayName
		actorUser := request.Actor.Username
		notifications = append(notifications, domain.AppNotification{
			ID:             fmt.Sprintf("friend_request:%s", request.Request.ID),
			Type:           domain.NotificationTypeFriendRequest,
			ActorAccountID: &actorID,
			ActorName:      &actorName,
			ActorUsername:  &actorUser,
			TargetID:       &targetID,
			Navigation: &domain.NotificationNavigation{
				Target:    domain.NotificationNavigationTargetFriendsRequest,
				AccountID: &actorID,
			},
			CreatedAt: request.Request.CreatedAt,
		})
	}

	accepted, err := s.repo.ListAcceptedFriendNotifications(ctx, principal.AccountID, fetchLimit)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load accepted friend notifications")
	}
	for _, request := range accepted {
		targetID := request.Request.ID
		actorID := request.Target.AccountID
		actorName := request.Target.DisplayName
		actorUser := request.Target.Username
		notifications = append(notifications, domain.AppNotification{
			ID:             fmt.Sprintf("friend_accepted:%s", request.Request.ID),
			Type:           domain.NotificationTypeFriendAccepted,
			ActorAccountID: &actorID,
			ActorName:      &actorName,
			ActorUsername:  &actorUser,
			TargetID:       &targetID,
			Navigation: &domain.NotificationNavigation{
				Target:    domain.NotificationNavigationTargetProfile,
				AccountID: &actorID,
			},
			CreatedAt: request.Request.UpdatedAt,
		})
	}

	stories, err := s.repo.ListFriendStoryNotifications(ctx, principal.AccountID, fetchLimit)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load story notifications")
	}
	for _, story := range stories {
		actorID := story.Story.OwnerAccountID
		actorName := story.OwnerName
		actorUser := story.OwnerUser
		targetID := story.Story.ID
		caption := story.Story.Caption
		notifications = append(notifications, domain.AppNotification{
			ID:             fmt.Sprintf("story_published:%s", story.Story.ID),
			Type:           domain.NotificationTypeStoryPublished,
			ActorAccountID: &actorID,
			ActorName:      &actorName,
			ActorUsername:  &actorUser,
			TargetID:       &targetID,
			Preview:        &caption,
			Navigation: &domain.NotificationNavigation{
				Target:    domain.NotificationNavigationTargetProfile,
				AccountID: &actorID,
			},
			CreatedAt: story.Story.CreatedAt,
		})
	}

	sort.SliceStable(notifications, func(i, j int) bool {
		return notifications[i].CreatedAt.After(notifications[j].CreatedAt)
	})

	filtered := make([]domain.AppNotification, 0, len(notifications))
	for _, item := range notifications {
		if state.ClearedBefore != nil && !item.CreatedAt.After(state.ClearedBefore.UTC()) {
			continue
		}
		filtered = append(filtered, item)
	}

	if len(filtered) == 0 {
		return ListResult{Notifications: []domain.AppNotification{}, Total: 0, UnreadTotal: 0}, nil
	}

	notificationIDs := make([]string, 0, len(filtered))
	for _, item := range filtered {
		notificationIDs = append(notificationIDs, item.ID)
	}
	readMarks, err := s.repo.ListNotificationReadMarksByIDs(ctx, principal.AccountID, notificationIDs)
	if err != nil {
		return ListResult{}, service.NewError(service.ErrorCodeInternal, "failed to load notification read marks")
	}

	unreadTotal := 0
	for index := range filtered {
		if readAt, ok := readMarks[filtered[index].ID]; ok {
			readCopy := readAt.UTC()
			filtered[index].IsRead = true
			filtered[index].ReadAt = &readCopy
			continue
		}
		if state.ReadBefore != nil && !filtered[index].CreatedAt.After(state.ReadBefore.UTC()) {
			readCopy := state.ReadBefore.UTC()
			filtered[index].IsRead = true
			filtered[index].ReadAt = &readCopy
			continue
		}
		unreadTotal += 1
	}

	total := len(filtered)
	if len(filtered) > limit {
		filtered = filtered[:limit]
	}

	return ListResult{
		Notifications: filtered,
		Total:         total,
		UnreadTotal:   unreadTotal,
	}, nil
}

func (s *Service) MarkRead(ctx context.Context, principal auth.AuthPrincipal, ids []string, all bool) (int, error) {
	now := time.Now().UTC()
	if !all && len(ids) == 0 {
		return 0, service.NewError(service.ErrorCodeValidation, "notification ids are required")
	}

	if all {
		if err := s.repo.SetNotificationsReadBefore(ctx, principal.AccountID, now); err != nil {
			return 0, service.NewError(service.ErrorCodeInternal, "failed to mark notifications as read")
		}
	}

	cleanIDs := normalizeNotificationIDs(ids)
	if len(cleanIDs) > 0 {
		if err := s.repo.UpsertNotificationReadMarks(ctx, principal.AccountID, cleanIDs, now); err != nil {
			return 0, service.NewError(service.ErrorCodeInternal, "failed to mark notifications as read")
		}
	}

	list, err := s.List(ctx, principal, 100)
	if err != nil {
		return 0, err
	}
	return list.UnreadTotal, nil
}

func (s *Service) Clear(ctx context.Context, principal auth.AuthPrincipal) (int, error) {
	now := time.Now().UTC()
	if err := s.repo.SetNotificationsClearedBefore(ctx, principal.AccountID, now); err != nil {
		return 0, service.NewError(service.ErrorCodeInternal, "failed to clear notifications")
	}
	if err := s.repo.ClearNotificationReadMarks(ctx, principal.AccountID); err != nil {
		return 0, service.NewError(service.ErrorCodeInternal, "failed to clear notifications")
	}

	list, err := s.List(ctx, principal, 100)
	if err != nil {
		return 0, err
	}
	return list.UnreadTotal, nil
}

func normalizeNotificationIDs(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, raw := range ids {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (s *Service) ListSince(ctx context.Context, principal auth.AuthPrincipal, since time.Time, limit int) ([]domain.AppNotification, error) {
	list, err := s.List(ctx, principal, limit)
	if err != nil {
		return nil, err
	}
	filtered := make([]domain.AppNotification, 0, len(list.Notifications))
	for _, item := range list.Notifications {
		if item.CreatedAt.After(since) {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}
