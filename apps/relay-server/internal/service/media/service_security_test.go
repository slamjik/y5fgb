package media

import (
	"encoding/base64"
	"testing"
)

func TestNormalizeMediaMimeType(t *testing.T) {
	if got := normalizeMediaMimeType(" image/jpg "); got != "image/jpeg" {
		t.Fatalf("expected image/jpg alias to normalize to image/jpeg, got %q", got)
	}
	if got := normalizeMediaMimeType("image/png; charset=binary"); got != "image/png" {
		t.Fatalf("expected mime parameters to be stripped, got %q", got)
	}
}

func TestInspectMediaPayloadImage(t *testing.T) {
	// 1x1 PNG
	payload, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Vr5cAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("failed to decode test payload: %v", err)
	}
	width, height, inspectErr := inspectMediaPayload(payload, "image/png")
	if inspectErr != nil {
		t.Fatalf("expected valid image payload, got %v", inspectErr)
	}
	if width != 1 || height != 1 {
		t.Fatalf("expected 1x1 image dimensions, got %dx%d", width, height)
	}
}

func TestInspectMediaPayloadRejectsMalformedImage(t *testing.T) {
	if _, _, err := inspectMediaPayload([]byte("not-an-image"), "image/png"); err == nil {
		t.Fatal("expected malformed image payload to be rejected")
	}
}

func TestInspectMediaPayloadSkipsNonImage(t *testing.T) {
	width, height, err := inspectMediaPayload([]byte("plain text"), "video/mp4")
	if err != nil {
		t.Fatalf("expected non-image payload checks to be skipped, got %v", err)
	}
	if width != 0 || height != 0 {
		t.Fatalf("expected zero dimensions for non-image payload, got %dx%d", width, height)
	}
}
