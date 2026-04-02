package api

import (
	"net/http"
	"testing"

	"github.com/example/secure-messenger/apps/relay-server/internal/service"
)

func TestStatusFromCodeMessaging(t *testing.T) {
	tests := []struct {
		code     service.ErrorCode
		expected int
	}{
		{code: service.ErrorCodeTransportUnavailable, expected: http.StatusServiceUnavailable},
		{code: service.ErrorCodeConversationNotFound, expected: http.StatusNotFound},
		{code: service.ErrorCodeMembershipDenied, expected: http.StatusForbidden},
		{code: service.ErrorCodeMessageExpired, expected: http.StatusGone},
	}

	for _, testCase := range tests {
		if got := statusFromCode(testCase.code); got != testCase.expected {
			t.Fatalf("unexpected status for %s: got %d expected %d", testCase.code, got, testCase.expected)
		}
	}
}
