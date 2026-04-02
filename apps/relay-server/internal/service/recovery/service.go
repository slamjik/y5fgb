package recovery

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/validation"
)

type Service struct {
	repo       *postgres.Store
	auth       *auth.Service
	events     *securityevents.Service
	tokenPepper string
}

type StartInput struct {
	Email             string
	ApprovalRequestID string
}

type StartResult struct {
	FlowID     string
	FlowToken  string
	ExpiresAt  time.Time
}

type CompleteInput struct {
	FlowID        string
	FlowToken     string
	RecoveryCode  string
	TwoFactorCode string
}

func New(repo *postgres.Store, authService *auth.Service, events *securityevents.Service, tokenPepper string) *Service {
	return &Service{repo: repo, auth: authService, events: events, tokenPepper: tokenPepper}
}

func (s *Service) Start(ctx context.Context, input StartInput) (*StartResult, error) {
	if err := validation.Email(input.Email); err != nil {
		return nil, service.NewError(service.ErrorCodeValidation, "invalid recovery payload")
	}
	if strings.TrimSpace(input.ApprovalRequestID) == "" {
		return nil, service.NewError(service.ErrorCodeValidation, "approvalRequestId is required")
	}

	account, err := s.repo.GetAccountByEmail(ctx, strings.ToLower(strings.TrimSpace(input.Email)))
	if err != nil {
		return nil, service.NewError(service.ErrorCodeNotFound, "account not found")
	}

	approval, err := s.repo.GetApprovalRequestByIDForAccount(ctx, input.ApprovalRequestID, account.ID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeNotFound, "approval request not found")
	}
	if approval.Status != domain.ApprovalStatusPending {
		return nil, service.NewError(service.ErrorCodeValidation, "approval request is not pending")
	}

	pendingDevice, err := s.repo.GetDeviceByID(ctx, approval.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeNotFound, "pending device not found")
	}
	if pendingDevice.Status != domain.DeviceStatusPending {
		return nil, service.NewError(service.ErrorCodeValidation, "device is not pending")
	}

	flowToken, err := security.GenerateOpaqueToken("rec_")
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to create recovery token")
	}

	expiresAt := time.Now().UTC().Add(15 * time.Minute)
	flow, err := s.repo.CreateRecoveryFlow(ctx, domain.RecoveryFlow{
		ID:              security.NewID(),
		AccountID:       account.ID,
		PendingDeviceID: pendingDevice.ID,
		Status:          domain.RecoveryFlowStatusStarted,
		FlowTokenHash:   security.HashToken(flowToken, s.tokenPepper),
		ExpiresAt:       expiresAt,
		StartedAt:       time.Now().UTC(),
	})
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to create recovery flow")
	}

	return &StartResult{FlowID: flow.ID, FlowToken: flowToken, ExpiresAt: flow.ExpiresAt}, nil
}

func (s *Service) Complete(ctx context.Context, input CompleteInput) error {
	if strings.TrimSpace(input.FlowID) == "" || strings.TrimSpace(input.FlowToken) == "" || strings.TrimSpace(input.RecoveryCode) == "" {
		return service.NewError(service.ErrorCodeValidation, "flowId, flowToken and recoveryCode are required")
	}

	flow, err := s.repo.GetRecoveryFlow(ctx, input.FlowID)
	if err != nil {
		return service.NewError(service.ErrorCodeInvalidRecoveryToken, "recovery flow not found")
	}
	if flow.Status != domain.RecoveryFlowStatusStarted {
		return service.NewError(service.ErrorCodeInvalidRecoveryToken, "recovery flow is not active")
	}
	if time.Now().UTC().After(flow.ExpiresAt) {
		return service.NewError(service.ErrorCodeInvalidRecoveryToken, "recovery flow expired")
	}

	providedHash := security.HashToken(input.FlowToken, s.tokenPepper)
	if !security.ConstantTimeEqual(providedHash, flow.FlowTokenHash) {
		return service.NewError(service.ErrorCodeInvalidRecoveryToken, "invalid recovery token")
	}

	if err := s.auth.RequireStepUpIfEnabled(ctx, flow.AccountID, input.TwoFactorCode); err != nil {
		return err
	}

	codeHash := security.HashToken(strings.TrimSpace(strings.ToUpper(input.RecoveryCode)), s.tokenPepper)
	consumedCode, err := s.repo.ConsumeRecoveryCode(ctx, flow.AccountID, codeHash)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return service.NewError(service.ErrorCodeInvalidRecoveryToken, "invalid recovery code")
		}
		return service.NewError(service.ErrorCodeInvalidRecoveryToken, "invalid recovery code")
	}

	if err := s.repo.SetDeviceStatus(ctx, flow.PendingDeviceID, domain.DeviceStatusTrusted); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to trust recovered device")
	}

	approval, err := s.repo.GetApprovalRequestByDeviceID(ctx, flow.PendingDeviceID)
	if err == nil {
		_ = s.repo.ResolveApprovalRequest(ctx, approval.ID, domain.ApprovalStatusApproved, nil)
	}

	if err := s.repo.CompleteRecoveryFlow(ctx, flow.ID, consumedCode.ID); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to complete recovery flow")
	}

	deviceID := flow.PendingDeviceID
	s.events.Record(ctx, flow.AccountID, &deviceID, domain.SecurityEventRecoveryUsed, domain.SecurityEventSeverityWarning, "warning", map[string]any{"flowId": flow.ID})
	s.events.Record(ctx, flow.AccountID, &deviceID, domain.SecurityEventDeviceApproved, domain.SecurityEventSeverityInfo, "trusted", map[string]any{"approvedVia": "recovery"})
	return nil
}
