package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/jackc/pgx/v5"
)

type CreateAccountParams struct {
	Account  domain.Account
	Identity domain.AccountIdentity
	Device   domain.Device
}

func (s *Store) CreateAccountWithIdentityAndFirstDevice(ctx context.Context, params CreateAccountParams) (domain.Account, domain.AccountIdentity, domain.Device, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Account{}, domain.AccountIdentity{}, domain.Device{}, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	now := time.Now().UTC()
	params.Account.CreatedAt = now
	params.Account.UpdatedAt = now
	params.Identity.CreatedAt = now
	params.Identity.UpdatedAt = now
	params.Device.CreatedAt = now
	if params.Device.KeyVersion <= 0 {
		params.Device.KeyVersion = 1
	}
	rotatedAt := params.Device.CreatedAt
	params.Device.RotatedAt = &rotatedAt
	if params.Device.RotationDueAt == nil {
		nextRotation := params.Device.CreatedAt.Add(180 * 24 * time.Hour)
		params.Device.RotationDueAt = &nextRotation
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO accounts (id, email, password_hash, two_fa_enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, params.Account.ID, params.Account.Email, params.Account.PasswordHash, params.Account.TwoFAEnabled, params.Account.CreatedAt, params.Account.UpdatedAt)
	if err != nil {
		return domain.Account{}, domain.AccountIdentity{}, domain.Device{}, normalizeWriteError(fmt.Errorf("failed to insert account: %w", err))
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO account_identities (
			account_id,
			public_identity_material,
			fingerprint,
			verification_state,
			trust_state,
			created_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, params.Identity.AccountID, params.Identity.PublicIdentityMaterial, params.Identity.Fingerprint, params.Identity.VerificationState, params.Identity.TrustState, params.Identity.CreatedAt, params.Identity.UpdatedAt)
	if err != nil {
		return domain.Account{}, domain.AccountIdentity{}, domain.Device{}, fmt.Errorf("failed to insert account identity: %w", err)
	}

	_, err = tx.Exec(ctx, `
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
			last_seen_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, params.Device.ID, params.Device.AccountID, params.Device.Name, params.Device.Platform, params.Device.PublicDeviceMaterial, params.Device.Fingerprint, params.Device.Status, params.Device.VerificationState, params.Device.KeyVersion, params.Device.RotatedAt, params.Device.RotationDueAt, params.Device.CreatedAt, params.Device.CreatedAt, params.Device.CreatedAt)
	if err != nil {
		return domain.Account{}, domain.AccountIdentity{}, domain.Device{}, normalizeWriteError(fmt.Errorf("failed to insert first device: %w", err))
	}

	lastSeen := params.Device.CreatedAt
	params.Device.LastSeenAt = &lastSeen

	if err := tx.Commit(ctx); err != nil {
		return domain.Account{}, domain.AccountIdentity{}, domain.Device{}, fmt.Errorf("failed to commit tx: %w", err)
	}

	return params.Account, params.Identity, params.Device, nil
}

func (s *Store) GetAccountByEmail(ctx context.Context, email string) (domain.Account, error) {
	var account domain.Account
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, two_fa_enabled, created_at, updated_at
		FROM accounts
		WHERE email = $1
	`, email).Scan(&account.ID, &account.Email, &account.PasswordHash, &account.TwoFAEnabled, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Account{}, ErrNotFound
		}
		return domain.Account{}, fmt.Errorf("failed to fetch account by email: %w", err)
	}

	return account, nil
}

func (s *Store) GetAccountByID(ctx context.Context, accountID string) (domain.Account, error) {
	var account domain.Account
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, two_fa_enabled, created_at, updated_at
		FROM accounts
		WHERE id = $1
	`, accountID).Scan(&account.ID, &account.Email, &account.PasswordHash, &account.TwoFAEnabled, &account.CreatedAt, &account.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Account{}, ErrNotFound
		}
		return domain.Account{}, fmt.Errorf("failed to fetch account by id: %w", err)
	}

	return account, nil
}

func (s *Store) SetAccountTwoFAEnabled(ctx context.Context, accountID string, enabled bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE accounts
		SET two_fa_enabled = $2, updated_at = NOW()
		WHERE id = $1
	`, accountID, enabled)
	if err != nil {
		return fmt.Errorf("failed to update account two_fa_enabled: %w", err)
	}
	return nil
}

func (s *Store) GetAccountIdentity(ctx context.Context, accountID string) (domain.AccountIdentity, error) {
	var identity domain.AccountIdentity
	err := s.pool.QueryRow(ctx, `
		SELECT account_id, public_identity_material, fingerprint, verification_state, trust_state, created_at, updated_at
		FROM account_identities
		WHERE account_id = $1
	`, accountID).Scan(
		&identity.AccountID,
		&identity.PublicIdentityMaterial,
		&identity.Fingerprint,
		&identity.VerificationState,
		&identity.TrustState,
		&identity.CreatedAt,
		&identity.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccountIdentity{}, ErrNotFound
		}
		return domain.AccountIdentity{}, fmt.Errorf("failed to fetch account identity: %w", err)
	}

	return identity, nil
}
