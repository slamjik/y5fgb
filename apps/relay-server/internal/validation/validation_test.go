package validation

import "testing"

func TestNormalizeMimeType(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "jpg alias", input: " image/jpg ", want: "image/jpeg"},
		{name: "with charset", input: "text/plain; charset=utf-8", want: "text/plain"},
		{name: "already normalized", input: "image/png", want: "image/png"},
	}

	for _, testCase := range tests {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			got := NormalizeMimeType(testCase.input)
			if got != testCase.want {
				t.Fatalf("NormalizeMimeType(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestFileNameRejectsUnsafeCharacters(t *testing.T) {
	unsafe := []string{
		"",
		"../secret.txt",
		`..\secret.txt`,
		"file/name.txt",
		"file\\name.txt",
		`bad:name.txt`,
		"bad\u0000name.txt",
		"bad\nname.txt",
	}
	for _, candidate := range unsafe {
		if err := FileName(candidate); err == nil {
			t.Fatalf("expected error for file name %q", candidate)
		}
	}

	if err := FileName("safe-file_01.txt"); err != nil {
		t.Fatalf("expected safe file name to pass validation, got %v", err)
	}
}

func TestContainsUnsafeControlChars(t *testing.T) {
	if !ContainsUnsafeControlChars("hello\x00world", false) {
		t.Fatal("expected null byte to be detected as unsafe")
	}
	if !ContainsUnsafeControlChars("hello\nworld", false) {
		t.Fatal("expected newline to be unsafe when multiline is disabled")
	}
	if ContainsUnsafeControlChars("hello\nworld", true) {
		t.Fatal("expected newline to be allowed when multiline is enabled")
	}
	if ContainsUnsafeControlChars("normal text", false) {
		t.Fatal("expected plain text to be safe")
	}
}
