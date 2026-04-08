package postgres

import "testing"

func TestDefaultUsernameFromAccount(t *testing.T) {
	tests := []struct {
		name      string
		accountID string
		email     string
	}{
		{
			name:      "normal email",
			accountID: "12345678-1234-1234-1234-123456789abc",
			email:     "alex.user@example.com",
		},
		{
			name:      "invalid chars in local part",
			accountID: "abcdef12-3456-7890-abcd-ef1234567890",
			email:     "ALEX+tag!@example.com",
		},
		{
			name:      "empty local part fallback",
			accountID: "00000000-0000-0000-0000-000000000000",
			email:     "@example.com",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			username := defaultUsernameFromAccount(tc.accountID, tc.email)
			if username == "" {
				t.Fatalf("username must not be empty")
			}
			if len(username) > 24 {
				t.Fatalf("username %q exceeds max length", username)
			}
		})
	}
}

func TestDefaultDisplayNameFromEmail(t *testing.T) {
	got := defaultDisplayNameFromEmail("  demo.user@example.com ")
	if got != "demo.user" {
		t.Fatalf("defaultDisplayNameFromEmail returned %q", got)
	}
}
