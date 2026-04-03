package postgres

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

const uniqueViolationCode = "23505"

var (
	ErrNotFound              = errors.New("not found")
	ErrDuplicateAccountEmail = errors.New("duplicate account email")
	ErrDuplicateDeviceID     = errors.New("duplicate device id")
)

func normalizeWriteError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}

	if pgErr.Code != uniqueViolationCode {
		return err
	}

	switch pgErr.ConstraintName {
	case "accounts_email_key":
		return ErrDuplicateAccountEmail
	case "devices_pkey":
		return ErrDuplicateDeviceID
	default:
		return err
	}
}

