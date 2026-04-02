package postgres

import (
	"context"
	"fmt"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
)

func (s *Store) InsertSecurityEvent(ctx context.Context, event domain.SecurityEvent) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO security_events (
			id,
			account_id,
			device_id,
			event_type,
			severity,
			trust_state,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, event.ID, event.AccountID, event.DeviceID, event.EventType, event.Severity, event.TrustState, event.Metadata, event.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert security event: %w", err)
	}

	return nil
}

func (s *Store) ListSecurityEvents(ctx context.Context, accountID string, limit int) ([]domain.SecurityEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, account_id, device_id, event_type, severity, trust_state, metadata, created_at
		FROM security_events
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list security events: %w", err)
	}
	defer rows.Close()

	events := make([]domain.SecurityEvent, 0)
	for rows.Next() {
		var event domain.SecurityEvent
		if err := rows.Scan(
			&event.ID,
			&event.AccountID,
			&event.DeviceID,
			&event.EventType,
			&event.Severity,
			&event.TrustState,
			&event.Metadata,
			&event.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan security event: %w", err)
		}
		events = append(events, event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate security event rows: %w", err)
	}

	return events, nil
}
