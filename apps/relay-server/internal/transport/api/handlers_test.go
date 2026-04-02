package api

import "testing"

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
