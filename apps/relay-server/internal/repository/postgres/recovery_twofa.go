package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) UpsertTwoFactorSecret(ctx context.Context, secret domain.TwoFactorSecret) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO two_factor_secrets (
			account_id,
			encrypted_secret,
			nonce,
			is_enabled,
			enabled_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET encrypted_secret = EXCLUDED.encrypted_secret,
			nonce = EXCLUDED.nonce,
			is_enabled = EXCLUDED.is_enabled,
			enabled_at = EXCLUDED.enabled_at,
			updated_at = NOW()
	`, secret.AccountID, secret.EncryptedSecret, secret.Nonce, secret.IsEnabled, secret.EnabledAt)
	if err != nil {
		return fmt.Errorf("failed to upsert two factor secret: %w", err)
	}

	return nil
}

func (s *Store) GetTwoFactorSecret(ctx context.Context, accountID string) (domain.TwoFactorSecret, error) {
	var secret domain.TwoFactorSecret
	err := s.pool.QueryRow(ctx, `
		SELECT account_id, encrypted_secret, nonce, is_enabled, enabled_at, created_at, updated_at
		FROM two_factor_secrets
		WHERE account_id = $1
	`, accountID).Scan(
		&secret.AccountID,
		&secret.EncryptedSecret,
		&secret.Nonce,
		&secret.IsEnabled,
		&secret.EnabledAt,
		&secret.CreatedAt,
		&secret.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TwoFactorSecret{}, ErrNotFound
		}
		return domain.TwoFactorSecret{}, fmt.Errorf("failed to fetch two factor secret: %w", err)
	}

	return secret, nil
}

func (s *Store) CreateTwoFactorChallenge(ctx context.Context, challenge domain.TwoFactorChallenge) (domain.TwoFactorChallenge, error) {
	if challenge.CreatedAt.IsZero() {
		challenge.CreatedAt = time.Now().UTC()
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO two_factor_challenges (
			id,
			account_id,
			device_id,
			challenge_type,
			pending_token_hash,
			status,
			expires_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, challenge.ID, challenge.AccountID, challenge.DeviceID, challenge.ChallengeType, challenge.PendingTokenHash, challenge.Status, challenge.ExpiresAt, challenge.CreatedAt)
	if err != nil {
		return domain.TwoFactorChallenge{}, fmt.Errorf("failed to create two factor challenge: %w", err)
	}

	return challenge, nil
}

func (s *Store) GetTwoFactorChallenge(ctx context.Context, challengeID string) (domain.TwoFactorChallenge, error) {
	var challenge domain.TwoFactorChallenge
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, device_id, challenge_type, pending_token_hash, status, expires_at, created_at, verified_at
		FROM two_factor_challenges
		WHERE id = $1
	`, challengeID).Scan(
		&challenge.ID,
		&challenge.AccountID,
		&challenge.DeviceID,
		&challenge.ChallengeType,
		&challenge.PendingTokenHash,
		&challenge.Status,
		&challenge.ExpiresAt,
		&challenge.CreatedAt,
		&challenge.VerifiedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TwoFactorChallenge{}, ErrNotFound
		}
		return domain.TwoFactorChallenge{}, fmt.Errorf("failed to fetch two factor challenge: %w", err)
	}

	return challenge, nil
}

func (s *Store) MarkTwoFactorChallengeVerified(ctx context.Context, challengeID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE two_factor_challenges
		SET status = 'verified', verified_at = NOW()
		WHERE id = $1
	`, challengeID)
	if err != nil {
		return fmt.Errorf("failed to mark challenge verified: %w", err)
	}

	return nil
}

func (s *Store) SetTwoFactorEnabled(ctx context.Context, accountID string, enabled bool) error {
	if enabled {
		_, err := s.pool.Exec(ctx, `
			UPDATE two_factor_secrets
			SET is_enabled = TRUE, enabled_at = COALESCE(enabled_at, NOW()), updated_at = NOW()
			WHERE account_id = $1
		`, accountID)
		if err != nil {
			return fmt.Errorf("failed to enable two factor: %w", err)
		}
	} else {
		_, err := s.pool.Exec(ctx, `
			UPDATE two_factor_secrets
			SET is_enabled = FALSE, updated_at = NOW()
			WHERE account_id = $1
		`, accountID)
		if err != nil {
			return fmt.Errorf("failed to disable two factor: %w", err)
		}
	}

	return nil
}

func (s *Store) ReplaceRecoveryCodes(ctx context.Context, accountID string, codes []domain.RecoveryCode) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin recovery code tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, "DELETE FROM recovery_codes WHERE account_id = $1", accountID); err != nil {
		return fmt.Errorf("failed to clear recovery codes: %w", err)
	}

	for _, code := range codes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO recovery_codes (id, account_id, code_hash, created_at)
			VALUES ($1,$2,$3,$4)
		`, code.ID, code.AccountID, code.CodeHash, code.CreatedAt); err != nil {
			return fmt.Errorf("failed to insert recovery code: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit recovery code tx: %w", err)
	}

	return nil
}

func (s *Store) ConsumeRecoveryCode(ctx context.Context, accountID string, codeHash string) (domain.RecoveryCode, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.RecoveryCode{}, fmt.Errorf("failed to begin consume recovery tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var code domain.RecoveryCode
	err = tx.QueryRow(ctx, `
		SELECT id, account_id, code_hash, used_at, created_at
		FROM recovery_codes
		WHERE account_id = $1 AND code_hash = $2
		FOR UPDATE
	`, accountID, codeHash).Scan(&code.ID, &code.AccountID, &code.CodeHash, &code.UsedAt, &code.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.RecoveryCode{}, ErrNotFound
		}
		return domain.RecoveryCode{}, fmt.Errorf("failed to fetch recovery code: %w", err)
	}

	if code.UsedAt != nil {
		return domain.RecoveryCode{}, fmt.Errorf("recovery code already used")
	}

	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `
		UPDATE recovery_codes
		SET used_at = $2
		WHERE id = $1
	`, code.ID, now); err != nil {
		return domain.RecoveryCode{}, fmt.Errorf("failed to mark recovery code used: %w", err)
	}
	code.UsedAt = &now

	if err := tx.Commit(ctx); err != nil {
		return domain.RecoveryCode{}, fmt.Errorf("failed to commit consume recovery tx: %w", err)
	}

	return code, nil
}

func (s *Store) CreateRecoveryFlow(ctx context.Context, flow domain.RecoveryFlow) (domain.RecoveryFlow, error) {
	if flow.StartedAt.IsZero() {
		flow.StartedAt = time.Now().UTC()
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO recovery_flows (
			id,
			account_id,
			pending_device_id,
			status,
			flow_token_hash,
			expires_at,
			started_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, flow.ID, flow.AccountID, flow.PendingDeviceID, flow.Status, flow.FlowTokenHash, flow.ExpiresAt, flow.StartedAt)
	if err != nil {
		return domain.RecoveryFlow{}, fmt.Errorf("failed to create recovery flow: %w", err)
	}

	return flow, nil
}

func (s *Store) GetRecoveryFlow(ctx context.Context, flowID string) (domain.RecoveryFlow, error) {
	var flow domain.RecoveryFlow
	err := s.pool.QueryRow(ctx, `
		SELECT id, account_id, pending_device_id, status, flow_token_hash, expires_at, started_at, completed_at, used_recovery_code_id
		FROM recovery_flows
		WHERE id = $1
	`).Scan(
		&flow.ID,
		&flow.AccountID,
		&flow.PendingDeviceID,
		&flow.Status,
		&flow.FlowTokenHash,
		&flow.ExpiresAt,
		&flow.StartedAt,
		&flow.CompletedAt,
		&flow.UsedRecoveryCode,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.RecoveryFlow{}, ErrNotFound
		}
		return domain.RecoveryFlow{}, fmt.Errorf("failed to fetch recovery flow: %w", err)
	}

	return flow, nil
}

func (s *Store) CompleteRecoveryFlow(ctx context.Context, flowID string, recoveryCodeID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE recovery_flows
		SET status = 'completed', completed_at = NOW(), used_recovery_code_id = $2
		WHERE id = $1
	`, flowID, recoveryCodeID)
	if err != nil {
		return fmt.Errorf("failed to complete recovery flow: %w", err)
	}

	return nil
}
