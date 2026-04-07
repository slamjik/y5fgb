package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func normalizeFriendPair(accountA string, accountB string) (string, string) {
	if accountA < accountB {
		return accountA, accountB
	}
	return accountB, accountA
}

func (s *Store) IsBlocked(ctx context.Context, blockerAccountID string, blockedAccountID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM user_blocks
			WHERE blocker_account_id = $1
			  AND blocked_account_id = $2
		)
	`, blockerAccountID, blockedAccountID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check user block: %w", err)
	}
	return exists, nil
}

func (s *Store) CreateOrUpdateFriendRequest(ctx context.Context, req domain.FriendRequest) (domain.FriendRequest, error) {
	if req.CreatedAt.IsZero() {
		req.CreatedAt = time.Now().UTC()
	}
	if req.UpdatedAt.IsZero() {
		req.UpdatedAt = req.CreatedAt
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO friend_requests (
			id,
			from_account_id,
			to_account_id,
			status,
			acted_by,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO UPDATE SET
			status = EXCLUDED.status,
			acted_by = EXCLUDED.acted_by,
			updated_at = EXCLUDED.updated_at
		RETURNING created_at, updated_at
	`, req.ID, req.FromAccountID, req.ToAccountID, req.Status, req.ActedBy, req.CreatedAt, req.UpdatedAt).Scan(
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err != nil {
		return domain.FriendRequest{}, fmt.Errorf("failed to create or update friend request: %w", err)
	}
	return req, nil
}

func (s *Store) CreateFriendRequest(ctx context.Context, req domain.FriendRequest) (domain.FriendRequest, error) {
	if req.CreatedAt.IsZero() {
		req.CreatedAt = time.Now().UTC()
	}
	req.UpdatedAt = req.CreatedAt

	err := s.pool.QueryRow(ctx, `
		INSERT INTO friend_requests (
			id,
			from_account_id,
			to_account_id,
			status,
			acted_by,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at, updated_at
	`, req.ID, req.FromAccountID, req.ToAccountID, req.Status, req.ActedBy, req.CreatedAt, req.UpdatedAt).Scan(
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err != nil {
		return domain.FriendRequest{}, fmt.Errorf("failed to create friend request: %w", err)
	}
	return req, nil
}

func (s *Store) FindActiveFriendRequestBetween(ctx context.Context, accountA string, accountB string) (domain.FriendRequest, error) {
	var req domain.FriendRequest
	err := s.pool.QueryRow(ctx, `
		SELECT id, from_account_id, to_account_id, status, acted_by, created_at, updated_at
		FROM friend_requests
		WHERE ((from_account_id = $1 AND to_account_id = $2) OR (from_account_id = $2 AND to_account_id = $1))
		  AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1
	`, accountA, accountB).Scan(
		&req.ID,
		&req.FromAccountID,
		&req.ToAccountID,
		&req.Status,
		&req.ActedBy,
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FriendRequest{}, ErrNotFound
		}
		return domain.FriendRequest{}, fmt.Errorf("failed to find active friend request: %w", err)
	}
	return req, nil
}

func (s *Store) GetFriendRequestByID(ctx context.Context, requestID string) (domain.FriendRequest, error) {
	var req domain.FriendRequest
	err := s.pool.QueryRow(ctx, `
		SELECT id, from_account_id, to_account_id, status, acted_by, created_at, updated_at
		FROM friend_requests
		WHERE id = $1
	`, requestID).Scan(
		&req.ID,
		&req.FromAccountID,
		&req.ToAccountID,
		&req.Status,
		&req.ActedBy,
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FriendRequest{}, ErrNotFound
		}
		return domain.FriendRequest{}, fmt.Errorf("failed to get friend request by id: %w", err)
	}
	return req, nil
}

func (s *Store) UpdateFriendRequestStatus(ctx context.Context, requestID string, status domain.FriendRequestStatus, actedBy *string) (domain.FriendRequest, error) {
	var req domain.FriendRequest
	err := s.pool.QueryRow(ctx, `
		UPDATE friend_requests
		SET
			status = $2,
			acted_by = $3,
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, from_account_id, to_account_id, status, acted_by, created_at, updated_at
	`, requestID, status, actedBy).Scan(
		&req.ID,
		&req.FromAccountID,
		&req.ToAccountID,
		&req.Status,
		&req.ActedBy,
		&req.CreatedAt,
		&req.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FriendRequest{}, ErrNotFound
		}
		return domain.FriendRequest{}, fmt.Errorf("failed to update friend request status: %w", err)
	}
	return req, nil
}

func (s *Store) ListFriendRequests(ctx context.Context, accountID string, direction string, limit int) ([]domain.FriendRequestListItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	normalizedDirection := strings.ToLower(strings.TrimSpace(direction))
	if normalizedDirection != "incoming" && normalizedDirection != "outgoing" {
		normalizedDirection = "incoming"
	}

	var whereClause string
	if normalizedDirection == "outgoing" {
		whereClause = "fr.from_account_id = $1"
	} else {
		whereClause = "fr.to_account_id = $1"
	}

	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT
			fr.id,
			fr.from_account_id,
			fr.to_account_id,
			fr.status,
			fr.acted_by,
			fr.created_at,
			fr.updated_at,
			actor.account_id,
			actor.username,
			actor.display_name,
			actor.avatar_media_id,
			target.account_id,
			target.username,
			target.display_name,
			target.avatar_media_id
		FROM friend_requests fr
		JOIN user_profiles actor ON actor.account_id = fr.from_account_id
		JOIN user_profiles target ON target.account_id = fr.to_account_id
		WHERE %s
		  AND fr.status = 'pending'
		ORDER BY fr.created_at DESC
		LIMIT $2
	`, whereClause), accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list friend requests: %w", err)
	}
	defer rows.Close()

	items := make([]domain.FriendRequestListItem, 0, limit)
	for rows.Next() {
		var item domain.FriendRequestListItem
		if scanErr := rows.Scan(
			&item.Request.ID,
			&item.Request.FromAccountID,
			&item.Request.ToAccountID,
			&item.Request.Status,
			&item.Request.ActedBy,
			&item.Request.CreatedAt,
			&item.Request.UpdatedAt,
			&item.Actor.AccountID,
			&item.Actor.Username,
			&item.Actor.DisplayName,
			&item.Actor.AvatarID,
			&item.Target.AccountID,
			&item.Target.Username,
			&item.Target.DisplayName,
			&item.Target.AvatarID,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan friend request row: %w", scanErr)
		}
		item.Direction = normalizedDirection
		item.IsOutgoing = normalizedDirection == "outgoing"
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate friend request rows: %w", err)
	}
	return items, nil
}

func (s *Store) UpsertFriendship(ctx context.Context, accountA string, accountB string) error {
	left, right := normalizeFriendPair(accountA, accountB)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO friendships (account_a_id, account_b_id, created_at)
		VALUES ($1,$2,NOW())
		ON CONFLICT (account_a_id, account_b_id) DO NOTHING
	`, left, right)
	if err != nil {
		return fmt.Errorf("failed to upsert friendship: %w", err)
	}
	return nil
}

func (s *Store) DeleteFriendship(ctx context.Context, accountA string, accountB string) error {
	left, right := normalizeFriendPair(accountA, accountB)
	_, err := s.pool.Exec(ctx, `
		DELETE FROM friendships
		WHERE account_a_id = $1
		  AND account_b_id = $2
	`, left, right)
	if err != nil {
		return fmt.Errorf("failed to delete friendship: %w", err)
	}
	return nil
}

func (s *Store) AreFriends(ctx context.Context, accountA string, accountB string) (bool, error) {
	left, right := normalizeFriendPair(accountA, accountB)
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE account_a_id = $1
			  AND account_b_id = $2
		)
	`, left, right).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check friendship: %w", err)
	}
	return exists, nil
}

func (s *Store) CountFriends(ctx context.Context, accountID string) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM friendships
		WHERE account_a_id = $1
		   OR account_b_id = $1
	`, accountID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count friendships: %w", err)
	}
	return count, nil
}

func (s *Store) ListFriends(ctx context.Context, accountID string, limit int) ([]domain.FriendListItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			p.account_id,
			p.username,
			p.display_name,
			p.avatar_media_id,
			f.created_at
		FROM friendships f
		JOIN user_profiles p ON p.account_id = CASE WHEN f.account_a_id = $1 THEN f.account_b_id ELSE f.account_a_id END
		WHERE f.account_a_id = $1 OR f.account_b_id = $1
		ORDER BY f.created_at DESC
		LIMIT $2
	`, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list friends: %w", err)
	}
	defer rows.Close()

	result := make([]domain.FriendListItem, 0, limit)
	for rows.Next() {
		var item domain.FriendListItem
		if scanErr := rows.Scan(
			&item.AccountID,
			&item.Username,
			&item.DisplayName,
			&item.AvatarID,
			&item.CreatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan friend row: %w", scanErr)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate friend rows: %w", err)
	}
	return result, nil
}

func (s *Store) UpsertBlock(ctx context.Context, blockerAccountID string, blockedAccountID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_blocks (blocker_account_id, blocked_account_id, created_at)
		VALUES ($1,$2,NOW())
		ON CONFLICT (blocker_account_id, blocked_account_id) DO NOTHING
	`, blockerAccountID, blockedAccountID)
	if err != nil {
		return fmt.Errorf("failed to upsert user block: %w", err)
	}
	return nil
}

func (s *Store) DeleteBlock(ctx context.Context, blockerAccountID string, blockedAccountID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM user_blocks
		WHERE blocker_account_id = $1
		  AND blocked_account_id = $2
	`, blockerAccountID, blockedAccountID)
	if err != nil {
		return fmt.Errorf("failed to delete user block: %w", err)
	}
	return nil
}

func (s *Store) DeletePendingFriendRequestsBetween(ctx context.Context, accountA string, accountB string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM friend_requests
		WHERE ((from_account_id = $1 AND to_account_id = $2) OR (from_account_id = $2 AND to_account_id = $1))
		  AND status = 'pending'
	`, accountA, accountB)
	if err != nil {
		return fmt.Errorf("failed to delete pending friend requests between accounts: %w", err)
	}
	return nil
}

func (s *Store) ListAcceptedFriendNotifications(ctx context.Context, accountID string, limit int) ([]domain.FriendRequestListItem, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			fr.id,
			fr.from_account_id,
			fr.to_account_id,
			fr.status,
			fr.acted_by,
			fr.created_at,
			fr.updated_at,
			actor.account_id,
			actor.username,
			actor.display_name,
			actor.avatar_media_id,
			target.account_id,
			target.username,
			target.display_name,
			target.avatar_media_id
		FROM friend_requests fr
		JOIN user_profiles actor ON actor.account_id = fr.from_account_id
		JOIN user_profiles target ON target.account_id = fr.to_account_id
		WHERE fr.from_account_id = $1
		  AND fr.status = 'accepted'
		  AND fr.acted_by = fr.to_account_id
		ORDER BY fr.updated_at DESC
		LIMIT $2
	`, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list accepted friend notifications: %w", err)
	}
	defer rows.Close()

	items := make([]domain.FriendRequestListItem, 0, limit)
	for rows.Next() {
		var item domain.FriendRequestListItem
		if scanErr := rows.Scan(
			&item.Request.ID,
			&item.Request.FromAccountID,
			&item.Request.ToAccountID,
			&item.Request.Status,
			&item.Request.ActedBy,
			&item.Request.CreatedAt,
			&item.Request.UpdatedAt,
			&item.Actor.AccountID,
			&item.Actor.Username,
			&item.Actor.DisplayName,
			&item.Actor.AvatarID,
			&item.Target.AccountID,
			&item.Target.Username,
			&item.Target.DisplayName,
			&item.Target.AvatarID,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan accepted friend notification row: %w", scanErr)
		}
		item.Direction = "outgoing"
		item.IsOutgoing = true
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate accepted friend notifications rows: %w", err)
	}
	return items, nil
}
