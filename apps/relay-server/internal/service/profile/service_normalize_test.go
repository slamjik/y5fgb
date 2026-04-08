package profile

import "testing"

func TestNormalizeProfileQuery(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "plain username", input: "nickname", want: "nickname"},
		{name: "leading at", input: "@nickname", want: "nickname"},
		{name: "multiple leading at", input: "@@@nickname", want: "nickname"},
		{name: "spaces around", input: "   @nickname   ", want: "nickname"},
		{name: "empty", input: "   ", want: ""},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeProfileQuery(tc.input)
			if got != tc.want {
				t.Fatalf("normalizeProfileQuery(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

