package security

import "testing"

func TestTokenHashAndEquality(t *testing.T) {
	token := "acc_example_token"
	pepper := "pepper"

	hashA := HashToken(token, pepper)
	hashB := HashToken(token, pepper)
	if hashA != hashB {
		t.Fatalf("expected token hashes to be deterministic")
	}

	if !ConstantTimeEqual(hashA, hashB) {
		t.Fatalf("expected ConstantTimeEqual to return true")
	}
	if ConstantTimeEqual(hashA, HashToken(token, "other")) {
		t.Fatalf("expected ConstantTimeEqual to return false for different hash")
	}
}
