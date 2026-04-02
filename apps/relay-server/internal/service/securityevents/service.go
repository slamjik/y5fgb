package securityevents

import (
	"context"
	"encoding/json"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
)

type Service struct {
	repo *postgres.Store
}

func New(repo *postgres.Store) *Service {
	return &Service{repo: repo}
}

func (s *Service) Record(ctx context.Context, accountID string, deviceID *string, eventType domain.SecurityEventType, severity domain.SecurityEventSeverity, trustState string, metadata map[string]any) {
	if metadata == nil {
		metadata = map[string]any{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		encoded = []byte("{}")
	}

	_ = s.repo.InsertSecurityEvent(ctx, domain.SecurityEvent{
		ID:         security.NewID(),
		AccountID:  accountID,
		DeviceID:   deviceID,
		EventType:  eventType,
		Severity:   severity,
		TrustState: trustState,
		Metadata:   encoded,
		CreatedAt:  time.Now().UTC(),
	})
}

func (s *Service) List(ctx context.Context, accountID string, limit int) ([]domain.SecurityEvent, error) {
	return s.repo.ListSecurityEvents(ctx, accountID, limit)
}
