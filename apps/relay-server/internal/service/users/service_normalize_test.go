package users

import "testing"

func TestNormalizeUserQuery(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "plain query", input: "alex", want: "alex"},
		{name: "leading at", input: "@alex", want: "alex"},
		{name: "multiple leading at", input: "@@@alex", want: "alex"},
		{name: "trim spaces", input: "   @alex   ", want: "alex"},
		{name: "email should keep inner at", input: "alex@mail.com", want: "alex@mail.com"},
		{name: "empty", input: "   ", want: ""},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeUserQuery(tc.input)
			if got != tc.want {
				t.Fatalf("normalizeUserQuery(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

