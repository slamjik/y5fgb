package notifications

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
)

type Service struct {
	repo *postgres.Store
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, principal auth.AuthPrincipal, limit int) ([]domain.AppNotification, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	notifications := make([]domain.AppNotification, 0, limit*2)

	likes, err := s.repo.ListSocialNotifications(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load social notifications")
	}
	for _, like := range likes {
		actorName := like.ActorEmail
		actorUser := like.ActorEmail
		targetID := like.PostID
		preview := like.PostPreview
		actorID := like.ActorAccountID
		notifications = append(notifications, domain.AppNotification{
			ID:             fmt.Sprintf("social_like:%s:%s:%d", like.PostID, like.ActorAccountID, like.CreatedAt.UnixNano()),
			Type:           domain.NotificationTypeSocialLike,
			ActorAccountID: &actorID,
			ActorName:      &actorName,
			ActorUsername:  &actorUser,
			TargetID:       &targetID,
			Preview:        &preview,
			CreatedAt:      like.CreatedAt,
		})
	}

	incoming, err := s.repo.ListFriendRequests(ctx, principal.AccountID, "incoming", limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load friend request notifications")
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
			CreatedAt:      request.Request.CreatedAt,
		})
	}

	accepted, err := s.repo.ListAcceptedFriendNotifications(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load accepted friend notifications")
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
			CreatedAt:      request.Request.UpdatedAt,
		})
	}

	stories, err := s.repo.ListFriendStoryNotifications(ctx, principal.AccountID, limit)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load story notifications")
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
			CreatedAt:      story.Story.CreatedAt,
		})
	}

	sort.SliceStable(notifications, func(i, j int) bool {
		return notifications[i].CreatedAt.After(notifications[j].CreatedAt)
	})

	if len(notifications) > limit {
		notifications = notifications[:limit]
	}
	return notifications, nil
}

func (s *Service) ListSince(ctx context.Context, principal auth.AuthPrincipal, since time.Time, limit int) ([]domain.AppNotification, error) {
	items, err := s.List(ctx, principal, limit)
	if err != nil {
		return nil, err
	}
	filtered := make([]domain.AppNotification, 0, len(items))
	for _, item := range items {
		if item.CreatedAt.After(since) {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}
