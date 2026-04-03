package postgres

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestNormalizeWriteError_UniqueConstraints(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantIsErr  error
		shouldWrap bool
	}{
		{
			name:      "account email unique violation",
			err:       &pgconn.PgError{Code: uniqueViolationCode, ConstraintName: "accounts_email_key"},
			wantIsErr: ErrDuplicateAccountEmail,
		},
		{
			name:      "device id unique violation",
			err:       &pgconn.PgError{Code: uniqueViolationCode, ConstraintName: "devices_pkey"},
			wantIsErr: ErrDuplicateDeviceID,
		},
		{
			name:      "other unique violation stays original",
			err:       &pgconn.PgError{Code: uniqueViolationCode, ConstraintName: "other_constraint"},
			wantIsErr: nil,
		},
		{
			name:      "non pg error stays original",
			err:       errors.New("boom"),
			wantIsErr: nil,
		},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got := normalizeWriteError(testCase.err)
			if testCase.wantIsErr == nil {
				if got != testCase.err {
					t.Fatalf("expected original error, got %v", got)
				}
				return
			}

			if !errors.Is(got, testCase.wantIsErr) {
				t.Fatalf("expected errors.Is(..., %v) = true, got err=%v", testCase.wantIsErr, got)
			}
		})
	}
}

