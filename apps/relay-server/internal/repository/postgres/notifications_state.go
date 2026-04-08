package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type NotificationState struct {
	ReadBefore    *time.Time
	ClearedBefore *time.Time
}

func (s *Store) GetNotificationState(ctx context.Context, accountID string) (NotificationState, error) {
	var state NotificationState
	err := s.pool.QueryRow(ctx, `
		SELECT read_before, cleared_before
		FROM account_notification_state
		WHERE account_id = $1
	`, accountID).Scan(&state.ReadBefore, &state.ClearedBefore)
	if err == nil {
		return state, nil
	}
	if err == pgx.ErrNoRows {
		return NotificationState{}, nil
	}
	return NotificationState{}, fmt.Errorf("failed to get notification state: %w", err)
}

func (s *Store) SetNotificationsReadBefore(ctx context.Context, accountID string, readBefore time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO account_notification_state (account_id, read_before, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET read_before = GREATEST(account_notification_state.read_before, EXCLUDED.read_before),
			updated_at = NOW()
	`, accountID, readBefore.UTC())
	if err != nil {
		return fmt.Errorf("failed to set notifications read_before: %w", err)
	}
	return nil
}

func (s *Store) SetNotificationsClearedBefore(ctx context.Context, accountID string, clearedBefore time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO account_notification_state (account_id, cleared_before, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET cleared_before = GREATEST(account_notification_state.cleared_before, EXCLUDED.cleared_before),
			updated_at = NOW()
	`, accountID, clearedBefore.UTC())
	if err != nil {
		return fmt.Errorf("failed to set notifications cleared_before: %w", err)
	}
	return nil
}

func (s *Store) UpsertNotificationReadMarks(ctx context.Context, accountID string, notificationIDs []string, readAt time.Time) error {
	if len(notificationIDs) == 0 {
		return nil
	}

	for _, notificationID := range notificationIDs {
		if notificationID == "" {
			continue
		}
		_, err := s.pool.Exec(ctx, `
			INSERT INTO account_notification_read_marks (account_id, notification_id, read_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (account_id, notification_id) DO UPDATE
			SET read_at = GREATEST(account_notification_read_marks.read_at, EXCLUDED.read_at)
		`, accountID, notificationID, readAt.UTC())
		if err != nil {
			return fmt.Errorf("failed to upsert notification read mark: %w", err)
		}
	}

	return nil
}

func (s *Store) ListNotificationReadMarksByIDs(ctx context.Context, accountID string, notificationIDs []string) (map[string]time.Time, error) {
	result := make(map[string]time.Time, len(notificationIDs))
	if len(notificationIDs) == 0 {
		return result, nil
	}

	rows, err := s.pool.Query(ctx, `
		SELECT notification_id, read_at
		FROM account_notification_read_marks
		WHERE account_id = $1
		  AND notification_id = ANY($2::text[])
	`, accountID, notificationIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list notification read marks: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var notificationID string
		var readAt time.Time
		if scanErr := rows.Scan(&notificationID, &readAt); scanErr != nil {
			return nil, fmt.Errorf("failed to scan notification read mark row: %w", scanErr)
		}
		result[notificationID] = readAt
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, fmt.Errorf("failed to iterate notification read mark rows: %w", rowsErr)
	}

	return result, nil
}

func (s *Store) ClearNotificationReadMarks(ctx context.Context, accountID string) error {
	if _, err := s.pool.Exec(ctx, `
		DELETE FROM account_notification_read_marks
		WHERE account_id = $1
	`, accountID); err != nil {
		return fmt.Errorf("failed to clear notification read marks: %w", err)
	}
	return nil
}
