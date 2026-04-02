package security

import "testing"

func TestFingerprintFromMaterial(t *testing.T) {
	fingerprint, safety := FingerprintFromMaterial("public-material")
	if len(fingerprint) != 64 {
		t.Fatalf("expected 64-char fingerprint, got %d", len(fingerprint))
	}
	if len(safety) != 64 {
		t.Fatalf("expected grouped safety number length 64, got %d", len(safety))
	}
}
