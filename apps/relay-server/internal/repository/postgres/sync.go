package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) GetDeviceSyncCursor(ctx context.Context, deviceID string) (domain.DeviceSyncCursor, error) {
	var cursor domain.DeviceSyncCursor
	err := s.pool.QueryRow(ctx, `
		SELECT cursor_id, device_id, last_cursor, updated_at
		FROM device_sync_cursors
		WHERE device_id = $1
	`, deviceID).Scan(
		&cursor.CursorID,
		&cursor.DeviceID,
		&cursor.LastCursor,
		&cursor.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DeviceSyncCursor{}, ErrNotFound
		}
		return domain.DeviceSyncCursor{}, fmt.Errorf("failed to fetch device sync cursor: %w", err)
	}

	return cursor, nil
}

func (s *Store) UpsertDeviceSyncCursor(ctx context.Context, cursor domain.DeviceSyncCursor) (domain.DeviceSyncCursor, error) {
	if cursor.UpdatedAt.IsZero() {
		cursor.UpdatedAt = time.Now().UTC()
	}

	err := s.pool.QueryRow(ctx, `
		INSERT INTO device_sync_cursors (cursor_id, device_id, last_cursor, updated_at)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (device_id) DO UPDATE
		SET last_cursor = GREATEST(device_sync_cursors.last_cursor, EXCLUDED.last_cursor),
			updated_at = EXCLUDED.updated_at
		RETURNING cursor_id, device_id, last_cursor, updated_at
	`, cursor.CursorID, cursor.DeviceID, cursor.LastCursor, cursor.UpdatedAt).Scan(
		&cursor.CursorID,
		&cursor.DeviceID,
		&cursor.LastCursor,
		&cursor.UpdatedAt,
	)
	if err != nil {
		return domain.DeviceSyncCursor{}, fmt.Errorf("failed to upsert device sync cursor: %w", err)
	}

	return cursor, nil
}

func (s *Store) GetMaxServerSequence(ctx context.Context) (int64, error) {
	var sequence int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(server_sequence), 0)
		FROM message_envelopes
	`).Scan(&sequence); err != nil {
		return 0, fmt.Errorf("failed to fetch max server sequence: %w", err)
	}
	return sequence, nil
}
