package api

import (
	"net/http/httptest"
	"testing"
)

func TestParseConversationRoute(t *testing.T) {
	conversationID, action, err := parseConversationRoute("/api/v1/conversations/11111111-1111-1111-1111-111111111111/messages")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if conversationID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("unexpected conversation id: %s", conversationID)
	}
	if action != "messages" {
		t.Fatalf("unexpected action: %s", action)
	}
}

func TestParseConversationRouteInvalid(t *testing.T) {
	if _, _, err := parseConversationRoute("/api/v1/conversations/"); err == nil {
		t.Fatal("expected parse error for invalid route")
	}
}

func TestParseMessageRoute(t *testing.T) {
	messageID, action, err := parseMessageRoute("/api/v1/messages/22222222-2222-2222-2222-222222222222/receipts")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if messageID != "22222222-2222-2222-2222-222222222222" {
		t.Fatalf("unexpected message id: %s", messageID)
	}
	if action != "receipts" {
		t.Fatalf("unexpected action: %s", action)
	}
}

func TestDefaultSyncQueryLimit(t *testing.T) {
	if got := defaultSyncQueryLimit(""); got != 100 {
		t.Fatalf("expected default 100, got %d", got)
	}
	if got := defaultSyncQueryLimit("999"); got != 200 {
		t.Fatalf("expected capped 200, got %d", got)
	}
	if got := defaultSyncQueryLimit("5"); got != 5 {
		t.Fatalf("expected parsed limit 5, got %d", got)
	}
}

func TestParseSocialPostRoute(t *testing.T) {
	postID, action, err := parseSocialPostRoute("/api/v1/social/posts/33333333-3333-3333-3333-333333333333/like")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if postID != "33333333-3333-3333-3333-333333333333" {
		t.Fatalf("unexpected post id: %s", postID)
	}
	if action != "like" {
		t.Fatalf("unexpected action: %s", action)
	}
}

func TestRequestSchemePrefersForwardedProto(t *testing.T) {
	req := httptest.NewRequest("GET", "http://localhost/api/v1/config", nil)
	req.Header.Set("X-Forwarded-Proto", "https")

	if got := requestScheme(req, true); got != "https" {
		t.Fatalf("expected https, got %s", got)
	}
}

func TestRequestHostPrefersForwardedHost(t *testing.T) {
	req := httptest.NewRequest("GET", "http://localhost/api/v1/config", nil)
	req.Header.Set("X-Forwarded-Host", "chat.example.com")
	req.Host = "localhost:8080"

	if got := requestHost(req, true); got != "chat.example.com" {
		t.Fatalf("expected forwarded host, got %s", got)
	}
}
