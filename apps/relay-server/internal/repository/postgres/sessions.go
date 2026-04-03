package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateSession(ctx context.Context, session domain.Session, userAgent string, ipAddress string) (domain.Session, error) {
	now := time.Now().UTC()
	if session.CreatedAt.IsZero() {
		session.CreatedAt = now
	}
	if session.ClientPlatform == "" {
		session.ClientPlatform = domain.ClientPlatformDesktopTauri
	}
	if session.SessionClass == "" {
		session.SessionClass = domain.SessionClassDevice
	}
	if session.SessionClass == domain.SessionClassDevice && !session.Persistent {
		session.Persistent = true
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (
			id,
			account_id,
			device_id,
			client_platform,
			session_class,
			persistent,
			access_token_hash,
			refresh_token_hash,
			previous_refresh_token_hash,
			status,
			access_token_expires_at,
			refresh_token_expires_at,
			created_at,
			last_seen_at,
			user_agent,
			ip_address
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
	`,
		session.ID,
		session.AccountID,
		session.DeviceID,
		session.ClientPlatform,
		session.SessionClass,
		session.Persistent,
		session.AccessTokenHash,
		session.RefreshTokenHash,
		session.PreviousRefreshTokenHash,
		session.Status,
		session.AccessTokenExpiresAt,
		session.RefreshTokenExpiresAt,
		session.CreatedAt,
		session.CreatedAt,
		userAgent,
		ipAddress,
	)
	if err != nil {
		return domain.Session{}, fmt.Errorf("failed to create session: %w", err)
	}

	lastSeen := session.CreatedAt
	session.LastSeenAt = &lastSeen
	return session, nil
}

func (s *Store) GetSessionByAccessHash(ctx context.Context, accessHash string) (domain.Session, error) {
	var session domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, client_platform, session_class, persistent, access_token_hash, refresh_token_hash, previous_refresh_token_hash,
			status, access_token_expires_at, refresh_token_expires_at, created_at, last_seen_at, revoked_at
		FROM sessions
		WHERE access_token_hash = $1
	`, accessHash).Scan(
		&session.ID,
		&session.AccountID,
		&session.DeviceID,
		&session.ClientPlatform,
		&session.SessionClass,
		&session.Persistent,
		&session.AccessTokenHash,
		&session.RefreshTokenHash,
		&session.PreviousRefreshTokenHash,
		&session.Status,
		&session.AccessTokenExpiresAt,
		&session.RefreshTokenExpiresAt,
		&session.CreatedAt,
		&session.LastSeenAt,
		&session.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("failed to fetch session by access hash: %w", err)
	}

	return session, nil
}

func (s *Store) GetSessionByID(ctx context.Context, sessionID string) (domain.Session, error) {
	var session domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, client_platform, session_class, persistent, access_token_hash, refresh_token_hash, previous_refresh_token_hash,
			status, access_token_expires_at, refresh_token_expires_at, created_at, last_seen_at, revoked_at
		FROM sessions
		WHERE id = $1
	`, sessionID).Scan(
		&session.ID,
		&session.AccountID,
		&session.DeviceID,
		&session.ClientPlatform,
		&session.SessionClass,
		&session.Persistent,
		&session.AccessTokenHash,
		&session.RefreshTokenHash,
		&session.PreviousRefreshTokenHash,
		&session.Status,
		&session.AccessTokenExpiresAt,
		&session.RefreshTokenExpiresAt,
		&session.CreatedAt,
		&session.LastSeenAt,
		&session.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("failed to fetch session by id: %w", err)
	}

	return session, nil
}

func (s *Store) GetSessionByRefreshHash(ctx context.Context, refreshHash string) (domain.Session, error) {
	var session domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, client_platform, session_class, persistent, access_token_hash, refresh_token_hash, previous_refresh_token_hash,
			status, access_token_expires_at, refresh_token_expires_at, created_at, last_seen_at, revoked_at
		FROM sessions
		WHERE refresh_token_hash = $1
	`, refreshHash).Scan(
		&session.ID,
		&session.AccountID,
		&session.DeviceID,
		&session.ClientPlatform,
		&session.SessionClass,
		&session.Persistent,
		&session.AccessTokenHash,
		&session.RefreshTokenHash,
		&session.PreviousRefreshTokenHash,
		&session.Status,
		&session.AccessTokenExpiresAt,
		&session.RefreshTokenExpiresAt,
		&session.CreatedAt,
		&session.LastSeenAt,
		&session.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("failed to fetch session by refresh hash: %w", err)
	}

	return session, nil
}

func (s *Store) GetSessionByPreviousRefreshHash(ctx context.Context, previousRefreshHash string) (domain.Session, error) {
	var session domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, client_platform, session_class, persistent, access_token_hash, refresh_token_hash, previous_refresh_token_hash,
			status, access_token_expires_at, refresh_token_expires_at, created_at, last_seen_at, revoked_at
		FROM sessions
		WHERE previous_refresh_token_hash = $1
	`, previousRefreshHash).Scan(
		&session.ID,
		&session.AccountID,
		&session.DeviceID,
		&session.ClientPlatform,
		&session.SessionClass,
		&session.Persistent,
		&session.AccessTokenHash,
		&session.RefreshTokenHash,
		&session.PreviousRefreshTokenHash,
		&session.Status,
		&session.AccessTokenExpiresAt,
		&session.RefreshTokenExpiresAt,
		&session.CreatedAt,
		&session.LastSeenAt,
		&session.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Session{}, ErrNotFound
		}
		return domain.Session{}, fmt.Errorf("failed to fetch session by previous refresh hash: %w", err)
	}

	return session, nil
}

func (s *Store) RotateSessionTokens(ctx context.Context, sessionID string, newAccessHash string, newRefreshHash string, accessExpiresAt time.Time, refreshExpiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET
			previous_refresh_token_hash = refresh_token_hash,
			refresh_token_hash = $2,
			access_token_hash = $3,
			access_token_expires_at = $4,
			refresh_token_expires_at = $5,
			last_seen_at = NOW()
		WHERE id = $1
	`, sessionID, newRefreshHash, newAccessHash, accessExpiresAt, refreshExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to rotate session tokens: %w", err)
	}

	return nil
}

func (s *Store) RevokeSession(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET status = 'revoked', revoked_at = NOW()
		WHERE id = $1
	`, sessionID)
	if err != nil {
		return fmt.Errorf("failed to revoke session: %w", err)
	}

	return nil
}

func (s *Store) RevokeSessionsByDeviceID(ctx context.Context, deviceID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET status = 'revoked', revoked_at = NOW()
		WHERE device_id = $1 AND status = 'active'
	`, deviceID)
	if err != nil {
		return fmt.Errorf("failed to revoke sessions by device: %w", err)
	}

	return nil
}

func (s *Store) RevokeSessionsByAccountID(ctx context.Context, accountID string) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET status = 'revoked', revoked_at = NOW()
		WHERE account_id = $1 AND status = 'active'
	`, accountID)
	if err != nil {
		return 0, fmt.Errorf("failed to revoke sessions by account: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (s *Store) TouchSessionLastSeen(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions
		SET last_seen_at = NOW()
		WHERE id = $1
	`, sessionID)
	if err != nil {
		return fmt.Errorf("failed to update session last_seen_at: %w", err)
	}

	return nil
}
