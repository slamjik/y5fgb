package messaging

import (
	"testing"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
)

func TestIsAllowedAttachmentMimeForKind(t *testing.T) {
	if !isAllowedAttachmentMimeForKind(domain.AttachmentKindImage, "image/jpeg") {
		t.Fatal("expected image/jpeg to be allowed for image attachments")
	}
	if isAllowedAttachmentMimeForKind(domain.AttachmentKindImage, "application/pdf") {
		t.Fatal("expected application/pdf to be rejected for image attachments")
	}
	if !isAllowedAttachmentMimeForKind(domain.AttachmentKindFile, "application/pdf") {
		t.Fatal("expected application/pdf to be allowed for file attachments")
	}
	if !isAllowedAttachmentMimeForKind(domain.AttachmentKindFile, "image/png") {
		t.Fatal("expected image/png to be allowed for file attachments")
	}
	if isAllowedAttachmentMimeForKind(domain.AttachmentKindFile, "image/svg+xml") {
		t.Fatal("expected image/svg+xml to be rejected for file attachments")
	}
}

func TestIsValidHexDigest(t *testing.T) {
	valid := "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
	if !isValidHexDigest(valid, 64) {
		t.Fatal("expected valid SHA-256 digest to pass")
	}
	if isValidHexDigest(valid[:63], 64) {
		t.Fatal("expected short digest to fail")
	}
	if isValidHexDigest(valid[:63]+"G", 64) {
		t.Fatal("expected non-hex character to fail")
	}
}
