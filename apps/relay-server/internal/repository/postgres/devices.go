package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) GetDeviceByID(ctx context.Context, deviceID string) (domain.Device, error) {
	var device domain.Device
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, name, platform, public_device_material, fingerprint, status, verification_state, key_version, rotated_at, rotation_due_at, created_at, last_seen_at, revoked_at
		FROM devices
		WHERE id = $1
	`, deviceID).Scan(
		&device.ID,
		&device.AccountID,
		&device.Name,
		&device.Platform,
		&device.PublicDeviceMaterial,
		&device.Fingerprint,
		&device.Status,
		&device.VerificationState,
		&device.KeyVersion,
		&device.RotatedAt,
		&device.RotationDueAt,
		&device.CreatedAt,
		&device.LastSeenAt,
		&device.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Device{}, ErrNotFound
		}
		return domain.Device{}, fmt.Errorf("failed to fetch device by id: %w", err)
	}

	return device, nil
}

func (s *Store) FindDeviceByAccountAndFingerprint(ctx context.Context, accountID string, fingerprint string) (domain.Device, error) {
	var device domain.Device
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, name, platform, public_device_material, fingerprint, status, verification_state, key_version, rotated_at, rotation_due_at, created_at, last_seen_at, revoked_at
		FROM devices
		WHERE account_id = $1 AND fingerprint = $2
	`, accountID, fingerprint).Scan(
		&device.ID,
		&device.AccountID,
		&device.Name,
		&device.Platform,
		&device.PublicDeviceMaterial,
		&device.Fingerprint,
		&device.Status,
		&device.VerificationState,
		&device.KeyVersion,
		&device.RotatedAt,
		&device.RotationDueAt,
		&device.CreatedAt,
		&device.LastSeenAt,
		&device.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Device{}, ErrNotFound
		}
		return domain.Device{}, fmt.Errorf("failed to fetch device by account+fingerprint: %w", err)
	}

	return device, nil
}

func (s *Store) CreateDevice(ctx context.Context, device domain.Device) (domain.Device, error) {
	now := time.Now().UTC()
	if device.CreatedAt.IsZero() {
		device.CreatedAt = now
	}
	if device.KeyVersion <= 0 {
		device.KeyVersion = 1
	}
	if device.RotatedAt == nil {
		rotatedAt := device.CreatedAt
		device.RotatedAt = &rotatedAt
	}
	if device.RotationDueAt == nil {
		nextRotation := device.CreatedAt.Add(180 * 24 * time.Hour)
		device.RotationDueAt = &nextRotation
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO devices (
			id,
			account_id,
			name,
			platform,
			public_device_material,
			fingerprint,
			status,
			verification_state,
			key_version,
			rotated_at,
			rotation_due_at,
			created_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
	`,
		device.ID,
		device.AccountID,
		device.Name,
		device.Platform,
		device.PublicDeviceMaterial,
		device.Fingerprint,
		device.Status,
		device.VerificationState,
		device.KeyVersion,
		device.RotatedAt,
		device.RotationDueAt,
		device.CreatedAt,
	)
	if err != nil {
		return domain.Device{}, fmt.Errorf("failed to create device: %w", err)
	}

	return device, nil
}

func (s *Store) TouchDeviceLastSeen(ctx context.Context, deviceID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE devices
		SET last_seen_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, deviceID)
	if err != nil {
		return fmt.Errorf("failed to update device last_seen_at: %w", err)
	}

	return nil
}

func (s *Store) CreateDeviceApprovalRequest(ctx context.Context, req domain.DeviceApprovalRequest) (domain.DeviceApprovalRequest, error) {
	now := time.Now().UTC()
	if req.CreatedAt.IsZero() {
		req.CreatedAt = now
	}

	err := s.pool.QueryRow(ctx, `
		INSERT INTO device_approval_requests (
			id,
			account_id,
			device_id,
			status,
			approved_by_device_id,
			poll_token_hash,
			poll_expires_at,
			created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (device_id) DO UPDATE
		SET
			status = EXCLUDED.status,
			approved_by_device_id = NULL,
			poll_token_hash = EXCLUDED.poll_token_hash,
			poll_expires_at = EXCLUDED.poll_expires_at,
			created_at = EXCLUDED.created_at,
			resolved_at = NULL
		RETURNING id, account_id, device_id, status, approved_by_device_id, poll_token_hash, poll_expires_at, created_at, resolved_at
	`, req.ID, req.AccountID, req.DeviceID, req.Status, req.ApprovedByDeviceID, req.PollTokenHash, req.PollExpiresAt, req.CreatedAt).Scan(
		&req.ID,
		&req.AccountID,
		&req.DeviceID,
		&req.Status,
		&req.ApprovedByDeviceID,
		&req.PollTokenHash,
		&req.PollExpiresAt,
		&req.CreatedAt,
		&req.ResolvedAt,
	)
	if err != nil {
		return domain.DeviceApprovalRequest{}, fmt.Errorf("failed to create approval request: %w", err)
	}

	return req, nil
}

func (s *Store) GetApprovalRequestByIDForAccount(ctx context.Context, approvalRequestID string, accountID string) (domain.DeviceApprovalRequest, error) {
	var req domain.DeviceApprovalRequest
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, status, approved_by_device_id, poll_token_hash, poll_expires_at, created_at, resolved_at
		FROM device_approval_requests
		WHERE id = $1 AND account_id = $2
	`, approvalRequestID, accountID).Scan(
		&req.ID,
		&req.AccountID,
		&req.DeviceID,
		&req.Status,
		&req.ApprovedByDeviceID,
		&req.PollTokenHash,
		&req.PollExpiresAt,
		&req.CreatedAt,
		&req.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DeviceApprovalRequest{}, ErrNotFound
		}
		return domain.DeviceApprovalRequest{}, fmt.Errorf("failed to fetch approval request: %w", err)
	}

	return req, nil
}

func (s *Store) GetApprovalRequestByDeviceID(ctx context.Context, deviceID string) (domain.DeviceApprovalRequest, error) {
	var req domain.DeviceApprovalRequest
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, status, approved_by_device_id, poll_token_hash, poll_expires_at, created_at, resolved_at
		FROM device_approval_requests
		WHERE device_id = $1
	`, deviceID).Scan(
		&req.ID,
		&req.AccountID,
		&req.DeviceID,
		&req.Status,
		&req.ApprovedByDeviceID,
		&req.PollTokenHash,
		&req.PollExpiresAt,
		&req.CreatedAt,
		&req.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DeviceApprovalRequest{}, ErrNotFound
		}
		return domain.DeviceApprovalRequest{}, fmt.Errorf("failed to fetch approval request by device: %w", err)
	}

	return req, nil
}

func (s *Store) GetApprovalRequestByPollToken(ctx context.Context, approvalRequestID string, pollTokenHash string) (domain.DeviceApprovalRequest, error) {
	var req domain.DeviceApprovalRequest
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, status, approved_by_device_id, poll_token_hash, poll_expires_at, created_at, resolved_at
		FROM device_approval_requests
		WHERE id = $1 AND poll_token_hash = $2
	`, approvalRequestID, pollTokenHash).Scan(
		&req.ID,
		&req.AccountID,
		&req.DeviceID,
		&req.Status,
		&req.ApprovedByDeviceID,
		&req.PollTokenHash,
		&req.PollExpiresAt,
		&req.CreatedAt,
		&req.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DeviceApprovalRequest{}, ErrNotFound
		}
		return domain.DeviceApprovalRequest{}, fmt.Errorf("failed to fetch approval request by poll token: %w", err)
	}

	return req, nil
}

func (s *Store) ResolveApprovalRequest(ctx context.Context, approvalRequestID string, status domain.ApprovalStatus, approvedByDeviceID *string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE device_approval_requests
		SET status = $2, approved_by_device_id = $3, resolved_at = NOW()
		WHERE id = $1
	`, approvalRequestID, status, approvedByDeviceID)
	if err != nil {
		return fmt.Errorf("failed to resolve approval request: %w", err)
	}

	return nil
}

func (s *Store) SetDeviceStatus(ctx context.Context, deviceID string, status domain.DeviceStatus) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE devices
		SET status = $2,
			updated_at = NOW(),
			revoked_at = CASE WHEN $2 = 'revoked' THEN NOW() ELSE revoked_at END
		WHERE id = $1
	`, deviceID, status)
	if err != nil {
		return fmt.Errorf("failed to update device status: %w", err)
	}

	return nil
}

func (s *Store) CountTrustedDevices(ctx context.Context, accountID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM devices
		WHERE account_id = $1 AND status = 'trusted'
	`, accountID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count trusted devices: %w", err)
	}

	return count, nil
}

func (s *Store) ListDevices(ctx context.Context, accountID string) ([]domain.Device, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, account_id, name, platform, public_device_material, fingerprint, status, verification_state, key_version, rotated_at, rotation_due_at, created_at, last_seen_at, revoked_at
		FROM devices
		WHERE account_id = $1
		ORDER BY created_at DESC
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("failed to list devices: %w", err)
	}
	defer rows.Close()

	result := make([]domain.Device, 0)
	for rows.Next() {
		var device domain.Device
		if err := rows.Scan(
			&device.ID,
			&device.AccountID,
			&device.Name,
			&device.Platform,
			&device.PublicDeviceMaterial,
			&device.Fingerprint,
			&device.Status,
			&device.VerificationState,
			&device.KeyVersion,
			&device.RotatedAt,
			&device.RotationDueAt,
			&device.CreatedAt,
			&device.LastSeenAt,
			&device.RevokedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan device row: %w", err)
		}
		result = append(result, device)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate devices rows: %w", err)
	}

	return result, nil
}

func (s *Store) GetLatestTrustedDeviceForAccount(ctx context.Context, accountID string) (domain.Device, error) {
	var device domain.Device
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, name, platform, public_device_material, fingerprint, status, verification_state, key_version, rotated_at, rotation_due_at, created_at, last_seen_at, revoked_at
		FROM devices
		WHERE account_id = $1 AND status = 'trusted'
		ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
		LIMIT 1
	`, accountID).Scan(
		&device.ID,
		&device.AccountID,
		&device.Name,
		&device.Platform,
		&device.PublicDeviceMaterial,
		&device.Fingerprint,
		&device.Status,
		&device.VerificationState,
		&device.KeyVersion,
		&device.RotatedAt,
		&device.RotationDueAt,
		&device.CreatedAt,
		&device.LastSeenAt,
		&device.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Device{}, ErrNotFound
		}
		return domain.Device{}, fmt.Errorf("failed to fetch latest trusted device: %w", err)
	}
	return device, nil
}

func (s *Store) ListApprovalRequests(ctx context.Context, accountID string) ([]domain.DeviceApprovalRequest, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, account_id, device_id, status, approved_by_device_id, poll_token_hash, poll_expires_at, created_at, resolved_at
		FROM device_approval_requests
		WHERE account_id = $1
		ORDER BY created_at DESC
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("failed to list approval requests: %w", err)
	}
	defer rows.Close()

	result := make([]domain.DeviceApprovalRequest, 0)
	for rows.Next() {
		var req domain.DeviceApprovalRequest
		if err := rows.Scan(
			&req.ID,
			&req.AccountID,
			&req.DeviceID,
			&req.Status,
			&req.ApprovedByDeviceID,
			&req.PollTokenHash,
			&req.PollExpiresAt,
			&req.CreatedAt,
			&req.ResolvedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan approval row: %w", err)
		}
		result = append(result, req)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate approval rows: %w", err)
	}

	return result, nil
}

func (s *Store) RotateDeviceKey(ctx context.Context, deviceID string, publicMaterial string, fingerprint string, keyVersion int, rotatedAt time.Time, rotationDueAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE devices
		SET
			public_device_material = $2,
			fingerprint = $3,
			key_version = $4,
			rotated_at = $5,
			rotation_due_at = $6,
			verification_state = 'changed',
			updated_at = NOW()
		WHERE id = $1
	`, deviceID, publicMaterial, fingerprint, keyVersion, rotatedAt, rotationDueAt)
	if err != nil {
		return fmt.Errorf("failed to rotate device key: %w", err)
	}
	return nil
}
