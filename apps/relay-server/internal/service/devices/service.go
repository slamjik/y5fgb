package devices

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
	repo        *postgres.Store
	auth        *auth.Service
	events      *securityevents.Service
	tokenPepper string
}

type DeviceListResult struct {
	CurrentDeviceID string
	Devices         []domain.Device
	Approvals       []domain.DeviceApprovalRequest
}

func New(repo *postgres.Store, authService *auth.Service, events *securityevents.Service, tokenPepper string) *Service {
	return &Service{repo: repo, auth: authService, events: events, tokenPepper: tokenPepper}
}

func (s *Service) List(ctx context.Context, principal auth.AuthPrincipal) (*DeviceListResult, error) {
	devices, err := s.repo.ListDevices(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list devices")
	}

	approvals, err := s.repo.ListApprovalRequests(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to list approval requests")
	}

	return &DeviceListResult{CurrentDeviceID: principal.DeviceID, Devices: devices, Approvals: approvals}, nil
}

func (s *Service) Approve(ctx context.Context, principal auth.AuthPrincipal, approvalRequestID string, twoFactorCode string) error {
	if err := s.auth.RequireStepUpIfEnabled(ctx, principal.AccountID, twoFactorCode); err != nil {
		return err
	}

	approverDevice, err := s.repo.GetDeviceByID(ctx, principal.DeviceID)
	if err != nil {
		return service.NewError(service.ErrorCodeUnauthorized, "approver device not found")
	}
	if approverDevice.Status != domain.DeviceStatusTrusted {
		return service.NewError(service.ErrorCodeDeviceNotApproved, "approver device is not trusted")
	}

	approval, err := s.repo.GetApprovalRequestByIDForAccount(ctx, approvalRequestID, principal.AccountID)
	if err != nil {
		return service.NewError(service.ErrorCodeNotFound, "approval request not found")
	}
	if approval.Status != domain.ApprovalStatusPending {
		return service.NewError(service.ErrorCodeValidation, "approval request is not pending")
	}

	targetDevice, err := s.repo.GetDeviceByID(ctx, approval.DeviceID)
	if err != nil {
		return service.NewError(service.ErrorCodeNotFound, "target device not found")
	}
	if targetDevice.Status != domain.DeviceStatusPending {
		return service.NewError(service.ErrorCodeValidation, "target device is not pending")
	}

	if err := s.repo.SetDeviceStatus(ctx, targetDevice.ID, domain.DeviceStatusTrusted); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to approve device")
	}

	approver := principal.DeviceID
	if err := s.repo.ResolveApprovalRequest(ctx, approval.ID, domain.ApprovalStatusApproved, &approver); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to mark approval request")
	}

	targetID := targetDevice.ID
	s.events.Record(ctx, principal.AccountID, &targetID, domain.SecurityEventDeviceApproved, domain.SecurityEventSeverityInfo, "trusted", map[string]any{"approvalRequestId": approval.ID})
	return nil
}

func (s *Service) Reject(ctx context.Context, principal auth.AuthPrincipal, approvalRequestID string, twoFactorCode string) error {
	if err := s.auth.RequireStepUpIfEnabled(ctx, principal.AccountID, twoFactorCode); err != nil {
		return err
	}

	approverDevice, err := s.repo.GetDeviceByID(ctx, principal.DeviceID)
	if err != nil {
		return service.NewError(service.ErrorCodeUnauthorized, "approver device not found")
	}
	if approverDevice.Status != domain.DeviceStatusTrusted {
		return service.NewError(service.ErrorCodeDeviceNotApproved, "approver device is not trusted")
	}

	approval, err := s.repo.GetApprovalRequestByIDForAccount(ctx, approvalRequestID, principal.AccountID)
	if err != nil {
		return service.NewError(service.ErrorCodeNotFound, "approval request not found")
	}
	if approval.Status != domain.ApprovalStatusPending {
		return service.NewError(service.ErrorCodeValidation, "approval request is not pending")
	}

	targetDevice, err := s.repo.GetDeviceByID(ctx, approval.DeviceID)
	if err != nil {
		return service.NewError(service.ErrorCodeNotFound, "target device not found")
	}

	if err := s.repo.SetDeviceStatus(ctx, targetDevice.ID, domain.DeviceStatusBlocked); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to reject device")
	}
	if err := s.repo.ResolveApprovalRequest(ctx, approval.ID, domain.ApprovalStatusRejected, nil); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to mark approval request")
	}

	targetID := targetDevice.ID
	s.events.Record(ctx, principal.AccountID, &targetID, domain.SecurityEventDeviceRejected, domain.SecurityEventSeverityWarning, "warning", map[string]any{"approvalRequestId": approval.ID})
	return nil
}

func (s *Service) Revoke(ctx context.Context, principal auth.AuthPrincipal, deviceID string, twoFactorCode string) error {
	if err := s.auth.RequireStepUpIfEnabled(ctx, principal.AccountID, twoFactorCode); err != nil {
		return err
	}

	targetDevice, err := s.repo.GetDeviceByID(ctx, deviceID)
	if err != nil {
		return service.NewError(service.ErrorCodeNotFound, "device not found")
	}
	if targetDevice.AccountID != principal.AccountID {
		return service.NewError(service.ErrorCodeForbidden, "cannot revoke device of another account")
	}
	if targetDevice.Status == domain.DeviceStatusRevoked || targetDevice.Status == domain.DeviceStatusBlocked {
		return service.NewError(service.ErrorCodeValidation, "device is already revoked or blocked")
	}

	if targetDevice.Status == domain.DeviceStatusTrusted {
		trustedCount, countErr := s.repo.CountTrustedDevices(ctx, principal.AccountID)
		if countErr != nil {
			return service.NewError(service.ErrorCodeInternal, "failed to validate trusted devices")
		}
		if trustedCount <= 1 {
			return service.NewError(service.ErrorCodeForbiddenLastTrustedRevoke, "cannot revoke last trusted device")
		}
	}

	if err := s.repo.SetDeviceStatus(ctx, targetDevice.ID, domain.DeviceStatusRevoked); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to revoke device")
	}
	if err := s.repo.RevokeSessionsByDeviceID(ctx, targetDevice.ID); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to revoke device sessions")
	}

	targetID := targetDevice.ID
	s.events.Record(ctx, principal.AccountID, &targetID, domain.SecurityEventDeviceRevoked, domain.SecurityEventSeverityWarning, "revoked", nil)
	return nil
}

func (s *Service) RotateCurrentDeviceKey(ctx context.Context, principal auth.AuthPrincipal, publicDeviceMaterial string, providedFingerprint string, twoFactorCode string) (domain.Device, error) {
	if err := s.auth.RequireStepUpIfEnabled(ctx, principal.AccountID, twoFactorCode); err != nil {
		return domain.Device{}, err
	}
	if err := validation.DeviceMaterial(publicDeviceMaterial); err != nil {
		return domain.Device{}, service.NewError(service.ErrorCodeValidation, "invalid device key material")
	}

	device, err := s.repo.GetDeviceByID(ctx, principal.DeviceID)
	if err != nil {
		return domain.Device{}, service.NewError(service.ErrorCodeNotFound, "device not found")
	}
	if device.AccountID != principal.AccountID {
		return domain.Device{}, service.NewError(service.ErrorCodeForbidden, "device does not belong to account")
	}
	if device.Status != domain.DeviceStatusTrusted {
		return domain.Device{}, service.NewError(service.ErrorCodeDeviceNotApproved, "only trusted devices can rotate keys")
	}

	fingerprint, _ := security.FingerprintFromMaterial(publicDeviceMaterial)
	if strings.TrimSpace(providedFingerprint) != "" && providedFingerprint != fingerprint {
		return domain.Device{}, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
	}
	if device.Fingerprint == fingerprint {
		return device, nil
	}

	keyVersion := device.KeyVersion + 1
	if keyVersion < 1 {
		keyVersion = 1
	}
	rotatedAt := time.Now().UTC()
	rotationDueAt := rotatedAt.Add(180 * 24 * time.Hour)
	if err := s.repo.RotateDeviceKey(ctx, device.ID, strings.TrimSpace(publicDeviceMaterial), fingerprint, keyVersion, rotatedAt, rotationDueAt); err != nil {
		return domain.Device{}, service.NewError(service.ErrorCodeInternal, "failed to rotate device key")
	}

	updated, err := s.repo.GetDeviceByID(ctx, device.ID)
	if err != nil {
		return domain.Device{}, service.NewError(service.ErrorCodeInternal, "failed to load rotated device")
	}

	deviceID := updated.ID
	s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventDeviceKeyChanged, domain.SecurityEventSeverityWarning, "warning", map[string]any{
		"keyVersion":      updated.KeyVersion,
		"rotationDueAt":   updated.RotationDueAt,
		"previousVersion": device.KeyVersion,
	})
	s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventIdentityChanged, domain.SecurityEventSeverityWarning, "warning", map[string]any{
		"reason":     "device_key_rotation",
		"keyVersion": updated.KeyVersion,
	})
	return updated, nil
}

func (s *Service) ApprovalStatus(ctx context.Context, approvalRequestID string, pollToken string) (domain.DeviceApprovalRequest, error) {
	if approvalRequestID == "" || pollToken == "" {
		return domain.DeviceApprovalRequest{}, service.NewError(service.ErrorCodeValidation, "approval request id and poll token are required")
	}

	hash := security.HashToken(pollToken, s.tokenPepper)
	approval, err := s.repo.GetApprovalRequestByPollToken(ctx, approvalRequestID, hash)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			return domain.DeviceApprovalRequest{}, service.NewError(service.ErrorCodeUnauthorized, "invalid approval status token")
		}
		return domain.DeviceApprovalRequest{}, service.NewError(service.ErrorCodeInternal, "failed to fetch approval status")
	}

	if time.Now().UTC().After(approval.PollExpiresAt) {
		if approval.Status == domain.ApprovalStatusPending {
			_ = s.repo.ResolveApprovalRequest(ctx, approval.ID, domain.ApprovalStatusExpired, nil)
			approval.Status = domain.ApprovalStatusExpired
		}
	}

	return approval, nil
}
