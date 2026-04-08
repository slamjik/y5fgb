package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/domain"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/security"
	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/validation"
)

type Service struct {
	cfg    config.Config
	repo   *postgres.Store
	events *securityevents.Service
}

type DeviceInput struct {
	DeviceID             string
	Name                 string
	Platform             string
	PublicDeviceMaterial string
	Fingerprint          string
}

type RegisterInput struct {
	Email                      string
	Password                   string
	AccountIdentityMaterial    string
	AccountIdentityFingerprint string
	Device                     DeviceInput
	UserAgent                  string
	IPAddress                  string
}

type LoginInput struct {
	Email     string
	Password  string
	Device    DeviceInput
	UserAgent string
	IPAddress string
}

type WebLoginInput struct {
	Email              string
	Password           string
	Device             DeviceInput
	SessionPersistence string
	UserAgent          string
	IPAddress          string
}

type WebRegisterInput struct {
	Email              string
	Password           string
	Device             DeviceInput
	SessionPersistence string
	UserAgent          string
	IPAddress          string
}

type VerifyTwoFALoginInput struct {
	ChallengeID string
	LoginToken  string
	Code        string
	UserAgent   string
	IPAddress   string
}

type VerifyWebTwoFALoginInput struct {
	ChallengeID        string
	LoginToken         string
	Code               string
	Device             *DeviceInput
	SessionPersistence string
	UserAgent          string
	IPAddress          string
}

type TokenPair struct {
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  time.Time
	RefreshTokenExpiresAt time.Time
}

type SessionEnvelope struct {
	Account  domain.Account
	Identity domain.AccountIdentity
	Device   domain.Device
	Session  domain.Session
	Tokens   TokenPair
}

type LoginResult struct {
	Session               *SessionEnvelope
	TwoFAChallengeID      string
	TwoFALoginToken       string
	TwoFAChallengeExpires *time.Time
	PendingApprovalID     string
	ApprovalPollToken     string
	ApprovalStatus        domain.ApprovalStatus
}

type AuthPrincipal struct {
	AccountID string
	DeviceID  string
	SessionID string
}

type SessionIssueOptions struct {
	ClientPlatform domain.ClientPlatform
	SessionClass   domain.SessionClass
	Persistent     bool
}

type TwoFASetupStartResult struct {
	Secret          string
	ProvisioningURI string
}

func New(cfg config.Config, repo *postgres.Store, events *securityevents.Service) *Service {
	return &Service{cfg: cfg, repo: repo, events: events}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (*SessionEnvelope, []string, error) {
	if err := validation.Email(input.Email); err != nil {
		return nil, nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"email": err.Error()})
	}
	if err := validation.Password(input.Password); err != nil {
		return nil, nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"password": err.Error()})
	}
	if strings.TrimSpace(input.AccountIdentityMaterial) == "" {
		return nil, nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"accountIdentityMaterial": "required"})
	}
	if err := validation.DeviceName(input.Device.Name); err != nil {
		return nil, nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"deviceName": err.Error()})
	}
	if err := validation.DeviceMaterial(input.Device.PublicDeviceMaterial); err != nil {
		return nil, nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"publicDeviceMaterial": err.Error()})
	}

	email := strings.ToLower(strings.TrimSpace(input.Email))
	accountFingerprint, _ := security.FingerprintFromMaterial(input.AccountIdentityMaterial)
	if input.AccountIdentityFingerprint != "" && input.AccountIdentityFingerprint != accountFingerprint {
		return nil, nil, service.NewError(service.ErrorCodeFingerprintMismatch, "account identity fingerprint mismatch")
	}
	deviceFingerprint, _ := security.FingerprintFromMaterial(input.Device.PublicDeviceMaterial)
	if input.Device.Fingerprint != "" && input.Device.Fingerprint != deviceFingerprint {
		return nil, nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
	}

	passwordHash, err := security.HashPassword(input.Password)
	if err != nil {
		return nil, nil, service.NewError(service.ErrorCodeInternal, "failed to hash password")
	}

	deviceID := input.Device.DeviceID
	if strings.TrimSpace(deviceID) == "" {
		deviceID = security.NewID()
	}

	accountID := security.NewID()
	account := domain.Account{
		ID:           accountID,
		Email:        email,
		PasswordHash: passwordHash,
		TwoFAEnabled: false,
	}
	identity := domain.AccountIdentity{
		AccountID:              accountID,
		PublicIdentityMaterial: input.AccountIdentityMaterial,
		Fingerprint:            accountFingerprint,
		VerificationState:      domain.VerificationStateVerified,
		TrustState:             "trusted",
	}
	device := domain.Device{
		ID:                   deviceID,
		AccountID:            accountID,
		Name:                 strings.TrimSpace(input.Device.Name),
		Platform:             strings.TrimSpace(input.Device.Platform),
		PublicDeviceMaterial: input.Device.PublicDeviceMaterial,
		Fingerprint:          deviceFingerprint,
		Status:               domain.DeviceStatusTrusted,
		VerificationState:    domain.VerificationStateVerified,
	}

	createdAccount, createdIdentity, createdDevice, err := s.repo.CreateAccountWithIdentityAndFirstDevice(ctx, postgres.CreateAccountParams{
		Account:  account,
		Identity: identity,
		Device:   device,
	})
	if err != nil {
		if errors.Is(err, postgres.ErrDuplicateAccountEmail) {
			return nil, nil, service.NewError(service.ErrorCodeAccountAlreadyExists, "account already exists")
		}

		// A device id can already exist (for example when the same desktop re-registers a new account).
		// Retry once with a fresh server-side device id instead of misreporting "account already exists".
		if errors.Is(err, postgres.ErrDuplicateDeviceID) {
			device.ID = security.NewID()
			createdAccount, createdIdentity, createdDevice, err = s.repo.CreateAccountWithIdentityAndFirstDevice(ctx, postgres.CreateAccountParams{
				Account:  account,
				Identity: identity,
				Device:   device,
			})
			if err == nil {
				goto registrationCreated
			}
			if errors.Is(err, postgres.ErrDuplicateAccountEmail) {
				return nil, nil, service.NewError(service.ErrorCodeAccountAlreadyExists, "account already exists")
			}
		}

		return nil, nil, service.NewError(service.ErrorCodeInternal, "failed to create account")
	}

registrationCreated:

	if err := s.repo.EnsureDefaultProfileAndPrivacy(ctx, createdAccount); err != nil {
		return nil, nil, service.NewError(service.ErrorCodeInternal, "failed to initialize default profile")
	}

	recoveryCodes, recoveryCodeModels, err := s.generateRecoveryCodes(createdAccount.ID, 10)
	if err != nil {
		return nil, nil, service.NewError(service.ErrorCodeInternal, "failed to generate recovery codes")
	}
	if err := s.repo.ReplaceRecoveryCodes(ctx, createdAccount.ID, recoveryCodeModels); err != nil {
		return nil, nil, service.NewError(service.ErrorCodeInternal, "failed to store recovery codes")
	}

	session, tokens, err := s.issueSession(ctx, createdAccount.ID, createdDevice.ID, input.UserAgent, input.IPAddress)
	if err != nil {
		return nil, nil, err
	}

	deviceIDRef := createdDevice.ID
	s.events.Record(ctx, createdAccount.ID, &deviceIDRef, domain.SecurityEventAccountRegistered, domain.SecurityEventSeverityInfo, "trusted", map[string]any{"email": createdAccount.Email})
	s.events.Record(ctx, createdAccount.ID, &deviceIDRef, domain.SecurityEventDeviceAdded, domain.SecurityEventSeverityInfo, "trusted", map[string]any{"deviceStatus": createdDevice.Status})

	return &SessionEnvelope{
		Account:  createdAccount,
		Identity: createdIdentity,
		Device:   createdDevice,
		Session:  session,
		Tokens:   tokens,
	}, recoveryCodes, nil
}

func (s *Service) RegisterWeb(ctx context.Context, input WebRegisterInput) (*SessionEnvelope, error) {
	if err := validation.Email(input.Email); err != nil {
		return nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"email": err.Error()})
	}
	if err := validation.Password(input.Password); err != nil {
		return nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"password": err.Error()})
	}
	if strings.TrimSpace(input.Device.PublicDeviceMaterial) == "" {
		input.Device.PublicDeviceMaterial = fmt.Sprintf("web_device_%s", security.NewID())
	}
	if strings.TrimSpace(input.Device.Name) == "" {
		input.Device.Name = "Web Browser"
	}
	if strings.TrimSpace(input.Device.Platform) == "" {
		input.Device.Platform = string(domain.ClientPlatformWebBrowser)
	}
	if err := validation.DeviceName(input.Device.Name); err != nil {
		return nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"deviceName": err.Error()})
	}
	if err := validation.DeviceMaterial(input.Device.PublicDeviceMaterial); err != nil {
		return nil, service.NewErrorWithDetails(service.ErrorCodeValidation, "invalid registration data", map[string]any{"publicDeviceMaterial": err.Error()})
	}

	email := strings.ToLower(strings.TrimSpace(input.Email))
	passwordHash, err := security.HashPassword(input.Password)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to hash password")
	}

	deviceFingerprint, _ := security.FingerprintFromMaterial(input.Device.PublicDeviceMaterial)
	if input.Device.Fingerprint != "" && input.Device.Fingerprint != deviceFingerprint {
		return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
	}

	deviceID := strings.TrimSpace(input.Device.DeviceID)
	if deviceID == "" {
		deviceID = security.NewID()
	}

	deviceName := strings.TrimSpace(input.Device.Name)
	if deviceName == "" {
		deviceName = "Web Browser"
	}
	devicePlatform := strings.TrimSpace(input.Device.Platform)
	if devicePlatform == "" {
		devicePlatform = string(domain.ClientPlatformWebBrowser)
	}

	accountID := security.NewID()
	accountIdentityMaterial := fmt.Sprintf("web_identity_%s", security.NewID())
	accountFingerprint, _ := security.FingerprintFromMaterial(accountIdentityMaterial)

	account := domain.Account{
		ID:           accountID,
		Email:        email,
		PasswordHash: passwordHash,
		TwoFAEnabled: false,
	}
	identity := domain.AccountIdentity{
		AccountID:              accountID,
		PublicIdentityMaterial: accountIdentityMaterial,
		Fingerprint:            accountFingerprint,
		VerificationState:      domain.VerificationStateVerified,
		TrustState:             "trusted",
	}
	device := domain.Device{
		ID:                   deviceID,
		AccountID:            accountID,
		Name:                 deviceName,
		Platform:             devicePlatform,
		PublicDeviceMaterial: input.Device.PublicDeviceMaterial,
		Fingerprint:          deviceFingerprint,
		Status:               domain.DeviceStatusTrusted,
		VerificationState:    domain.VerificationStateVerified,
	}

	createdAccount, createdIdentity, createdDevice, err := s.repo.CreateAccountWithIdentityAndFirstDevice(ctx, postgres.CreateAccountParams{
		Account:  account,
		Identity: identity,
		Device:   device,
	})
	if err != nil {
		if errors.Is(err, postgres.ErrDuplicateAccountEmail) {
			return nil, service.NewError(service.ErrorCodeAccountAlreadyExists, "account already exists")
		}
		if errors.Is(err, postgres.ErrDuplicateDeviceID) {
			device.ID = security.NewID()
			createdAccount, createdIdentity, createdDevice, err = s.repo.CreateAccountWithIdentityAndFirstDevice(ctx, postgres.CreateAccountParams{
				Account:  account,
				Identity: identity,
				Device:   device,
			})
			if err == nil {
				goto webRegistrationCreated
			}
			if errors.Is(err, postgres.ErrDuplicateAccountEmail) {
				return nil, service.NewError(service.ErrorCodeAccountAlreadyExists, "account already exists")
			}
		}
		return nil, service.NewError(service.ErrorCodeInternal, "failed to create account")
	}

webRegistrationCreated:

	if err := s.repo.EnsureDefaultProfileAndPrivacy(ctx, createdAccount); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to initialize default profile")
	}

	sessionOptions := s.resolveWebSessionIssueOptions(input.SessionPersistence)
	session, tokens, err := s.issueSessionWithOptions(ctx, createdAccount.ID, createdDevice.ID, input.UserAgent, input.IPAddress, sessionOptions)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchDeviceLastSeen(ctx, createdDevice.ID)

	deviceIDRef := createdDevice.ID
	s.events.Record(ctx, createdAccount.ID, &deviceIDRef, domain.SecurityEventAccountRegistered, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"email":    createdAccount.Email,
		"platform": string(domain.ClientPlatformWebBrowser),
	})
	s.events.Record(ctx, createdAccount.ID, &deviceIDRef, domain.SecurityEventDeviceAdded, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"deviceStatus": createdDevice.Status,
		"platform":     string(domain.ClientPlatformWebBrowser),
	})

	return &SessionEnvelope{
		Account:  createdAccount,
		Identity: createdIdentity,
		Device:   createdDevice,
		Session:  session,
		Tokens:   tokens,
	}, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (*LoginResult, error) {
	if err := validation.Email(input.Email); err != nil {
		return nil, service.NewError(service.ErrorCodeValidation, "invalid login payload")
	}
	if strings.TrimSpace(input.Password) == "" {
		return nil, service.NewError(service.ErrorCodeValidation, "password is required")
	}
	if err := validation.DeviceName(input.Device.Name); err != nil {
		return nil, service.NewError(service.ErrorCodeValidation, "invalid device payload")
	}
	if err := validation.DeviceMaterial(input.Device.PublicDeviceMaterial); err != nil {
		return nil, service.NewError(service.ErrorCodeValidation, "invalid device payload")
	}

	email := strings.ToLower(strings.TrimSpace(input.Email))
	account, err := s.repo.GetAccountByEmail(ctx, email)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInvalidCredentials, "invalid credentials")
	}

	validPassword, err := security.VerifyPassword(input.Password, account.PasswordHash)
	if err != nil || !validPassword {
		s.events.Record(ctx, account.ID, nil, domain.SecurityEventLoginFailed, domain.SecurityEventSeverityWarning, "warning", map[string]any{"reason": "invalid_password"})
		return nil, service.NewError(service.ErrorCodeInvalidCredentials, "invalid credentials")
	}

	fingerprint, _ := security.FingerprintFromMaterial(input.Device.PublicDeviceMaterial)
	if input.Device.Fingerprint != "" && input.Device.Fingerprint != fingerprint {
		return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
	}

	if strings.TrimSpace(input.Device.DeviceID) != "" {
		existingByID, existingErr := s.repo.GetDeviceByID(ctx, input.Device.DeviceID)
		if existingErr == nil && existingByID.AccountID == account.ID && existingByID.Fingerprint != fingerprint {
			deviceIDRef := existingByID.ID
			s.events.Record(ctx, account.ID, &deviceIDRef, domain.SecurityEventIdentityChanged, domain.SecurityEventSeverityWarning, "warning", map[string]any{"reason": "device_fingerprint_mismatch"})
			return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
		}
	}

	device, err := s.repo.FindDeviceByAccountAndFingerprint(ctx, account.ID, fingerprint)
	if err != nil {
		if !errors.Is(err, postgres.ErrNotFound) {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to fetch device")
		}

		deviceID := input.Device.DeviceID
		if strings.TrimSpace(deviceID) == "" {
			deviceID = security.NewID()
		}

		device = domain.Device{
			ID:                   deviceID,
			AccountID:            account.ID,
			Name:                 strings.TrimSpace(input.Device.Name),
			Platform:             strings.TrimSpace(input.Device.Platform),
			PublicDeviceMaterial: input.Device.PublicDeviceMaterial,
			Fingerprint:          fingerprint,
			Status:               domain.DeviceStatusPending,
			VerificationState:    domain.VerificationStateUnverified,
		}

		createdDevice, createErr := s.repo.CreateDevice(ctx, device)
		if createErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create pending device")
		}
		device = createdDevice

		pollToken, tokenErr := security.GenerateOpaqueToken("poll_")
		if tokenErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create poll token")
		}

		approval := domain.DeviceApprovalRequest{
			ID:            security.NewID(),
			AccountID:     account.ID,
			DeviceID:      device.ID,
			Status:        domain.ApprovalStatusPending,
			PollTokenHash: security.HashToken(pollToken, s.cfg.Auth.TokenPepper),
			PollExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		}
		createdApproval, approvalErr := s.repo.CreateDeviceApprovalRequest(ctx, approval)
		if approvalErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create approval request")
		}

		pendingDeviceID := device.ID
		s.events.Record(ctx, account.ID, &pendingDeviceID, domain.SecurityEventDevicePending, domain.SecurityEventSeverityWarning, "warning", map[string]any{"approvalRequestId": createdApproval.ID})

		return &LoginResult{
			PendingApprovalID: createdApproval.ID,
			ApprovalPollToken: pollToken,
			ApprovalStatus:    createdApproval.Status,
		}, nil
	}

	if device.Status != domain.DeviceStatusTrusted {
		if device.Status == domain.DeviceStatusPending {
			pollToken, tokenErr := security.GenerateOpaqueToken("poll_")
			if tokenErr != nil {
				return nil, service.NewError(service.ErrorCodeInternal, "failed to create poll token")
			}

			approval := domain.DeviceApprovalRequest{
				ID:            security.NewID(),
				AccountID:     account.ID,
				DeviceID:      device.ID,
				Status:        domain.ApprovalStatusPending,
				PollTokenHash: security.HashToken(pollToken, s.cfg.Auth.TokenPepper),
				PollExpiresAt: time.Now().UTC().Add(24 * time.Hour),
			}
			createdApproval, approvalErr := s.repo.CreateDeviceApprovalRequest(ctx, approval)
			if approvalErr != nil {
				return nil, service.NewError(service.ErrorCodeInternal, "failed to create approval request")
			}

			return &LoginResult{
				PendingApprovalID: createdApproval.ID,
				ApprovalPollToken: pollToken,
				ApprovalStatus:    createdApproval.Status,
			}, nil
		}

		return nil, service.NewErrorWithDetails(service.ErrorCodeDeviceNotApproved, "device is not approved", map[string]any{"status": device.Status})
	}

	if account.TwoFAEnabled {
		loginToken, tokenErr := security.GenerateOpaqueToken("login_")
		if tokenErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create login challenge")
		}

		challenge := domain.TwoFactorChallenge{
			ID:               security.NewID(),
			AccountID:        account.ID,
			DeviceID:         device.ID,
			ChallengeType:    "login",
			PendingTokenHash: security.HashToken(loginToken, s.cfg.Auth.TokenPepper),
			Status:           "pending",
			ExpiresAt:        time.Now().UTC().Add(s.cfg.Auth.TwoFAChallengeTTL),
		}

		createdChallenge, createErr := s.repo.CreateTwoFactorChallenge(ctx, challenge)
		if createErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create login challenge")
		}

		return &LoginResult{
			TwoFAChallengeID:      createdChallenge.ID,
			TwoFALoginToken:       loginToken,
			TwoFAChallengeExpires: &createdChallenge.ExpiresAt,
		}, nil
	}

	session, tokens, err := s.issueSession(ctx, account.ID, device.ID, input.UserAgent, input.IPAddress)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchDeviceLastSeen(ctx, device.ID)

	deviceIDRef := device.ID
	s.events.Record(ctx, account.ID, &deviceIDRef, domain.SecurityEventLoginSuccess, domain.SecurityEventSeverityInfo, "trusted", nil)

	identity, _ := s.repo.GetAccountIdentity(ctx, account.ID)
	return &LoginResult{
		Session: &SessionEnvelope{
			Account:  account,
			Identity: identity,
			Device:   device,
			Session:  session,
			Tokens:   tokens,
		},
	}, nil
}

func (s *Service) LoginWeb(ctx context.Context, input WebLoginInput) (*LoginResult, error) {
	if err := validation.Email(input.Email); err != nil {
		return nil, service.NewError(service.ErrorCodeValidation, "invalid login payload")
	}
	if strings.TrimSpace(input.Password) == "" {
		return nil, service.NewError(service.ErrorCodeValidation, "password is required")
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	account, err := s.repo.GetAccountByEmail(ctx, email)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInvalidCredentials, "invalid credentials")
	}

	validPassword, err := security.VerifyPassword(input.Password, account.PasswordHash)
	if err != nil || !validPassword {
		s.events.Record(ctx, account.ID, nil, domain.SecurityEventLoginFailed, domain.SecurityEventSeverityWarning, "warning", map[string]any{
			"reason":   "invalid_password",
			"platform": string(domain.ClientPlatformWebBrowser),
		})
		return nil, service.NewError(service.ErrorCodeInvalidCredentials, "invalid credentials")
	}

	var device domain.Device
	if strings.TrimSpace(input.Device.PublicDeviceMaterial) == "" {
		device, err = s.repo.GetLatestTrustedDeviceForAccount(ctx, account.ID)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				return nil, service.NewError(service.ErrorCodeDeviceNotApproved, "account has no trusted device")
			}
			return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve trusted device")
		}
	} else {
		if strings.TrimSpace(input.Device.Name) == "" {
			input.Device.Name = "Web Browser"
		}
		if strings.TrimSpace(input.Device.Platform) == "" {
			input.Device.Platform = string(domain.ClientPlatformWebBrowser)
		}
		if err := validation.DeviceName(input.Device.Name); err != nil {
			return nil, service.NewError(service.ErrorCodeValidation, "invalid device payload")
		}
		if err := validation.DeviceMaterial(input.Device.PublicDeviceMaterial); err != nil {
			return nil, service.NewError(service.ErrorCodeValidation, "invalid device payload")
		}

		fingerprint, _ := security.FingerprintFromMaterial(input.Device.PublicDeviceMaterial)
		if input.Device.Fingerprint != "" && input.Device.Fingerprint != fingerprint {
			return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
		}

		if strings.TrimSpace(input.Device.DeviceID) != "" {
			existingByID, existingErr := s.repo.GetDeviceByID(ctx, input.Device.DeviceID)
			if existingErr == nil && existingByID.AccountID == account.ID && existingByID.Fingerprint != fingerprint {
				deviceIDRef := existingByID.ID
				s.events.Record(ctx, account.ID, &deviceIDRef, domain.SecurityEventIdentityChanged, domain.SecurityEventSeverityWarning, "warning", map[string]any{
					"reason":   "device_fingerprint_mismatch",
					"platform": string(domain.ClientPlatformWebBrowser),
				})
				return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
			}
		}

		device, err = s.repo.FindDeviceByAccountAndFingerprint(ctx, account.ID, fingerprint)
		if err != nil {
			if !errors.Is(err, postgres.ErrNotFound) {
				return nil, service.NewError(service.ErrorCodeInternal, "failed to resolve web device")
			}

			deviceID := strings.TrimSpace(input.Device.DeviceID)
			if deviceID == "" {
				deviceID = security.NewID()
			}

			newDevice := domain.Device{
				ID:                   deviceID,
				AccountID:            account.ID,
				Name:                 strings.TrimSpace(input.Device.Name),
				Platform:             strings.TrimSpace(input.Device.Platform),
				PublicDeviceMaterial: input.Device.PublicDeviceMaterial,
				Fingerprint:          fingerprint,
				Status:               domain.DeviceStatusTrusted,
				VerificationState:    domain.VerificationStateVerified,
			}

			createdDevice, createErr := s.repo.CreateDevice(ctx, newDevice)
			if createErr != nil {
				if errors.Is(createErr, postgres.ErrDuplicateDeviceID) {
					newDevice.ID = security.NewID()
					createdDevice, createErr = s.repo.CreateDevice(ctx, newDevice)
				}
			}
			if createErr != nil {
				return nil, service.NewError(service.ErrorCodeInternal, "failed to create trusted web device")
			}

			device = createdDevice
			deviceIDRef := device.ID
			s.events.Record(ctx, account.ID, &deviceIDRef, domain.SecurityEventDeviceAdded, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
				"deviceStatus": device.Status,
				"platform":     string(domain.ClientPlatformWebBrowser),
			})
		}
	}

	if device.Status != domain.DeviceStatusTrusted {
		return nil, service.NewErrorWithDetails(service.ErrorCodeDeviceNotApproved, "device is not approved", map[string]any{"status": device.Status})
	}

	sessionOptions := s.resolveWebSessionIssueOptions(input.SessionPersistence)

	if account.TwoFAEnabled {
		loginToken, tokenErr := security.GenerateOpaqueToken("login_")
		if tokenErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create login challenge")
		}

		challenge := domain.TwoFactorChallenge{
			ID:               security.NewID(),
			AccountID:        account.ID,
			DeviceID:         device.ID,
			ChallengeType:    "login",
			PendingTokenHash: security.HashToken(loginToken, s.cfg.Auth.TokenPepper),
			Status:           "pending",
			ExpiresAt:        time.Now().UTC().Add(s.cfg.Auth.TwoFAChallengeTTL),
		}

		createdChallenge, createErr := s.repo.CreateTwoFactorChallenge(ctx, challenge)
		if createErr != nil {
			return nil, service.NewError(service.ErrorCodeInternal, "failed to create login challenge")
		}

		return &LoginResult{
			TwoFAChallengeID:      createdChallenge.ID,
			TwoFALoginToken:       loginToken,
			TwoFAChallengeExpires: &createdChallenge.ExpiresAt,
		}, nil
	}

	session, tokens, err := s.issueSessionWithOptions(ctx, account.ID, device.ID, input.UserAgent, input.IPAddress, sessionOptions)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchDeviceLastSeen(ctx, device.ID)

	deviceIDRef := device.ID
	s.events.Record(ctx, account.ID, &deviceIDRef, domain.SecurityEventLoginSuccess, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"platform": string(domain.ClientPlatformWebBrowser),
		"class":    string(domain.SessionClassBrowser),
	})

	identity, _ := s.repo.GetAccountIdentity(ctx, account.ID)
	return &LoginResult{
		Session: &SessionEnvelope{
			Account:  account,
			Identity: identity,
			Device:   device,
			Session:  session,
			Tokens:   tokens,
		},
	}, nil
}

func (s *Service) VerifyTwoFALogin(ctx context.Context, input VerifyTwoFALoginInput) (*SessionEnvelope, error) {
	challenge, err := s.repo.GetTwoFactorChallenge(ctx, input.ChallengeID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge")
	}
	if challenge.Status != "pending" {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge status")
	}
	if time.Now().UTC().After(challenge.ExpiresAt) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "two-factor challenge expired")
	}

	inputHash := security.HashToken(input.LoginToken, s.cfg.Auth.TokenPepper)
	if !security.ConstantTimeEqual(inputHash, challenge.PendingTokenHash) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge token")
	}

	secret, err := s.repo.GetTwoFactorSecret(ctx, challenge.AccountID)
	if err != nil || !secret.IsEnabled {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "two-factor setup not enabled")
	}

	decryptedSecret, err := security.DecryptSecret(secret.EncryptedSecret, secret.Nonce, s.cfg.Security.EncryptionKey)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to decrypt two-factor secret")
	}
	if !security.VerifyTOTP(decryptedSecret, input.Code) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor code")
	}

	device, err := s.repo.GetDeviceByID(ctx, challenge.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid device for challenge")
	}
	if device.Status != domain.DeviceStatusTrusted {
		return nil, service.NewError(service.ErrorCodeDeviceNotApproved, "device is not approved")
	}

	if err := s.repo.MarkTwoFactorChallengeVerified(ctx, challenge.ID); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to verify challenge")
	}

	session, tokens, err := s.issueSession(ctx, challenge.AccountID, challenge.DeviceID, input.UserAgent, input.IPAddress)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchDeviceLastSeen(ctx, challenge.DeviceID)

	account, err := s.repo.GetAccountByID(ctx, challenge.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to fetch account")
	}
	identity, _ := s.repo.GetAccountIdentity(ctx, challenge.AccountID)

	deviceIDRef := challenge.DeviceID
	s.events.Record(ctx, challenge.AccountID, &deviceIDRef, domain.SecurityEventLoginSuccess, domain.SecurityEventSeverityInfo, "trusted", map[string]any{"with2fa": true})

	return &SessionEnvelope{
		Account:  account,
		Identity: identity,
		Device:   device,
		Session:  session,
		Tokens:   tokens,
	}, nil
}

func (s *Service) VerifyWebTwoFALogin(ctx context.Context, input VerifyWebTwoFALoginInput) (*SessionEnvelope, error) {
	challenge, err := s.repo.GetTwoFactorChallenge(ctx, input.ChallengeID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge")
	}
	if challenge.Status != "pending" {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge status")
	}
	if time.Now().UTC().After(challenge.ExpiresAt) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "two-factor challenge expired")
	}

	inputHash := security.HashToken(input.LoginToken, s.cfg.Auth.TokenPepper)
	if !security.ConstantTimeEqual(inputHash, challenge.PendingTokenHash) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor challenge token")
	}

	secret, err := s.repo.GetTwoFactorSecret(ctx, challenge.AccountID)
	if err != nil || !secret.IsEnabled {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "two-factor setup not enabled")
	}

	decryptedSecret, err := security.DecryptSecret(secret.EncryptedSecret, secret.Nonce, s.cfg.Security.EncryptionKey)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to decrypt two-factor secret")
	}
	if !security.VerifyTOTP(decryptedSecret, input.Code) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor code")
	}

	if err := s.repo.MarkTwoFactorChallengeVerified(ctx, challenge.ID); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to verify challenge")
	}

	device, err := s.repo.GetDeviceByID(ctx, challenge.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid device for challenge")
	}
	if input.Device != nil {
		if strings.TrimSpace(input.Device.DeviceID) != "" && strings.TrimSpace(input.Device.DeviceID) != device.ID {
			return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid device for challenge")
		}
		if strings.TrimSpace(input.Device.PublicDeviceMaterial) != "" {
			inputFingerprint, _ := security.FingerprintFromMaterial(strings.TrimSpace(input.Device.PublicDeviceMaterial))
			if device.Fingerprint != inputFingerprint {
				return nil, service.NewError(service.ErrorCodeFingerprintMismatch, "device fingerprint mismatch")
			}
		}
	}

	sessionOptions := s.resolveWebSessionIssueOptions(input.SessionPersistence)
	session, tokens, err := s.issueSessionWithOptions(ctx, challenge.AccountID, challenge.DeviceID, input.UserAgent, input.IPAddress, sessionOptions)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchDeviceLastSeen(ctx, challenge.DeviceID)

	account, err := s.repo.GetAccountByID(ctx, challenge.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to fetch account")
	}
	identity, _ := s.repo.GetAccountIdentity(ctx, challenge.AccountID)

	deviceIDRef := challenge.DeviceID
	s.events.Record(ctx, challenge.AccountID, &deviceIDRef, domain.SecurityEventLoginSuccess, domain.SecurityEventSeverityInfo, "trusted", map[string]any{
		"with2fa":    true,
		"platform":   string(domain.ClientPlatformWebBrowser),
		"class":      string(domain.SessionClassBrowser),
		"persistent": sessionOptions.Persistent,
	})

	return &SessionEnvelope{
		Account:  account,
		Identity: identity,
		Device:   device,
		Session:  session,
		Tokens:   tokens,
	}, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (*SessionEnvelope, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "refresh token is required")
	}

	hash := security.HashToken(refreshToken, s.cfg.Auth.TokenPepper)
	sessionRecord, err := s.repo.GetSessionByRefreshHash(ctx, hash)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			if previousSession, prevErr := s.repo.GetSessionByPreviousRefreshHash(ctx, hash); prevErr == nil {
				revokedCount, revokeErr := s.repo.RevokeSessionsByAccountID(ctx, previousSession.AccountID)
				if revokeErr != nil {
					return nil, service.NewError(service.ErrorCodeInternal, "failed to revoke sessions after refresh reuse")
				}
				s.events.Record(ctx, previousSession.AccountID, nil, domain.SecurityEventRefreshTokenReuse, domain.SecurityEventSeverityCritical, "warning", map[string]any{
					"revokedSessions": revokedCount,
				})
			}
			return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid refresh token")
		}
		return nil, service.NewError(service.ErrorCodeInternal, "failed to load session")
	}

	if sessionRecord.Status != domain.SessionStatusActive {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "session is not active")
	}
	if time.Now().UTC().After(sessionRecord.RefreshTokenExpiresAt) {
		_ = s.repo.RevokeSession(ctx, sessionRecord.ID)
		return nil, service.NewError(service.ErrorCodeUnauthorized, "refresh token expired")
	}

	newAccessToken, err := security.GenerateOpaqueToken("acc_")
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to issue access token")
	}
	newRefreshToken, err := security.GenerateOpaqueToken("ref_")
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to issue refresh token")
	}

	accessExpiresAt := time.Now().UTC().Add(s.cfg.Auth.AccessTokenTTL)
	refreshExpiresAt := time.Now().UTC().Add(s.cfg.Auth.RefreshTokenTTL)
	if err := s.repo.RotateSessionTokens(
		ctx,
		sessionRecord.ID,
		security.HashToken(newAccessToken, s.cfg.Auth.TokenPepper),
		security.HashToken(newRefreshToken, s.cfg.Auth.TokenPepper),
		accessExpiresAt,
		refreshExpiresAt,
	); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to rotate session")
	}

	account, err := s.repo.GetAccountByID(ctx, sessionRecord.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to fetch account")
	}
	identity, _ := s.repo.GetAccountIdentity(ctx, sessionRecord.AccountID)
	device, err := s.repo.GetDeviceByID(ctx, sessionRecord.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to fetch device")
	}

	sessionRecord.AccessTokenExpiresAt = accessExpiresAt
	sessionRecord.RefreshTokenExpiresAt = refreshExpiresAt

	return &SessionEnvelope{
		Account:  account,
		Identity: identity,
		Device:   device,
		Session:  sessionRecord,
		Tokens: TokenPair{
			AccessToken:           newAccessToken,
			RefreshToken:          newRefreshToken,
			AccessTokenExpiresAt:  accessExpiresAt,
			RefreshTokenExpiresAt: refreshExpiresAt,
		},
	}, nil
}

func (s *Service) Logout(ctx context.Context, principal *AuthPrincipal, refreshToken string) error {
	if principal != nil && principal.SessionID != "" {
		if err := s.repo.RevokeSession(ctx, principal.SessionID); err != nil {
			return service.NewError(service.ErrorCodeInternal, "failed to revoke session")
		}
		return nil
	}

	if strings.TrimSpace(refreshToken) == "" {
		return service.NewError(service.ErrorCodeValidation, "refresh token is required when no access token provided")
	}

	hash := security.HashToken(refreshToken, s.cfg.Auth.TokenPepper)
	sessionRecord, err := s.repo.GetSessionByRefreshHash(ctx, hash)
	if err != nil {
		return service.NewError(service.ErrorCodeUnauthorized, "invalid refresh token")
	}
	if err := s.repo.RevokeSession(ctx, sessionRecord.ID); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to revoke session")
	}
	return nil
}

func (s *Service) LogoutAll(ctx context.Context, principal AuthPrincipal) (int64, error) {
	revoked, err := s.repo.RevokeSessionsByAccountID(ctx, principal.AccountID)
	if err != nil {
		return 0, service.NewError(service.ErrorCodeInternal, "failed to revoke all sessions")
	}
	return revoked, nil
}

func (s *Service) GetSessionEnvelope(ctx context.Context, principal AuthPrincipal) (*SessionEnvelope, error) {
	account, err := s.repo.GetAccountByID(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "account not found")
	}
	identity, _ := s.repo.GetAccountIdentity(ctx, principal.AccountID)
	device, err := s.repo.GetDeviceByID(ctx, principal.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "device not found")
	}
	sessionRecord, err := s.repo.GetSessionByID(ctx, principal.SessionID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "session not found")
	}

	return &SessionEnvelope{
		Account:  account,
		Identity: identity,
		Device:   device,
		Session:  sessionRecord,
	}, nil
}

func (s *Service) StartTwoFASetup(ctx context.Context, principal AuthPrincipal) (*TwoFASetupStartResult, error) {
	account, err := s.repo.GetAccountByID(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "account not found")
	}

	secret, provisioningURI, err := security.NewTOTPSecret(account.Email, s.cfg.Auth.Issuer)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to generate two-factor secret")
	}

	encryptedSecret, nonce, err := security.EncryptSecret(secret, s.cfg.Security.EncryptionKey)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to encrypt two-factor secret")
	}

	if err := s.repo.UpsertTwoFactorSecret(ctx, domain.TwoFactorSecret{
		AccountID:       principal.AccountID,
		EncryptedSecret: encryptedSecret,
		Nonce:           nonce,
		IsEnabled:       false,
	}); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to persist two-factor setup")
	}

	return &TwoFASetupStartResult{Secret: secret, ProvisioningURI: provisioningURI}, nil
}

func (s *Service) ConfirmTwoFASetup(ctx context.Context, principal AuthPrincipal, code string) ([]string, error) {
	if strings.TrimSpace(code) == "" {
		return nil, service.NewError(service.ErrorCodeValidation, "two-factor code is required")
	}

	secretRow, err := s.repo.GetTwoFactorSecret(ctx, principal.AccountID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeNotFound, "two-factor setup is not started")
	}

	decryptedSecret, err := security.DecryptSecret(secretRow.EncryptedSecret, secretRow.Nonce, s.cfg.Security.EncryptionKey)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to decrypt two-factor secret")
	}
	if !security.VerifyTOTP(decryptedSecret, code) {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor code")
	}

	if err := s.repo.SetTwoFactorEnabled(ctx, principal.AccountID, true); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to enable two-factor")
	}
	if err := s.repo.SetAccountTwoFAEnabled(ctx, principal.AccountID, true); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to update account two-factor flag")
	}

	recoveryCodes, recoveryCodeModels, err := s.generateRecoveryCodes(principal.AccountID, 10)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to generate recovery codes")
	}
	if err := s.repo.ReplaceRecoveryCodes(ctx, principal.AccountID, recoveryCodeModels); err != nil {
		return nil, service.NewError(service.ErrorCodeInternal, "failed to store recovery codes")
	}

	deviceID := principal.DeviceID
	s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventTwoFAEnabled, domain.SecurityEventSeverityInfo, "trusted", nil)

	return recoveryCodes, nil
}

func (s *Service) DisableTwoFA(ctx context.Context, principal AuthPrincipal, code string) error {
	account, err := s.repo.GetAccountByID(ctx, principal.AccountID)
	if err != nil {
		return service.NewError(service.ErrorCodeUnauthorized, "account not found")
	}
	if !account.TwoFAEnabled {
		return nil
	}
	if err := s.RequireStepUpIfEnabled(ctx, principal.AccountID, code); err != nil {
		return err
	}

	if err := s.repo.SetTwoFactorEnabled(ctx, principal.AccountID, false); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to disable two-factor")
	}
	if err := s.repo.SetAccountTwoFAEnabled(ctx, principal.AccountID, false); err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to update account two-factor flag")
	}

	deviceID := principal.DeviceID
	s.events.Record(ctx, principal.AccountID, &deviceID, domain.SecurityEventTwoFADisabled, domain.SecurityEventSeverityWarning, "warning", nil)
	return nil
}

func (s *Service) AuthenticateAccessToken(ctx context.Context, accessToken string) (*AuthPrincipal, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "missing access token")
	}

	hash := security.HashToken(accessToken, s.cfg.Auth.TokenPepper)
	sessionRecord, err := s.repo.GetSessionByAccessHash(ctx, hash)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "invalid access token")
	}
	if sessionRecord.Status != domain.SessionStatusActive {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "session is not active")
	}
	if time.Now().UTC().After(sessionRecord.AccessTokenExpiresAt) {
		_ = s.repo.RevokeSession(ctx, sessionRecord.ID)
		return nil, service.NewError(service.ErrorCodeUnauthorized, "access token expired")
	}

	device, err := s.repo.GetDeviceByID(ctx, sessionRecord.DeviceID)
	if err != nil {
		return nil, service.NewError(service.ErrorCodeUnauthorized, "session device not found")
	}
	if device.Status != domain.DeviceStatusTrusted {
		return nil, service.NewError(service.ErrorCodeDeviceNotApproved, "device is not trusted")
	}

	_ = s.repo.TouchSessionLastSeen(ctx, sessionRecord.ID)
	_ = s.repo.TouchDeviceLastSeen(ctx, sessionRecord.DeviceID)

	return &AuthPrincipal{AccountID: sessionRecord.AccountID, DeviceID: sessionRecord.DeviceID, SessionID: sessionRecord.ID}, nil
}

func (s *Service) RequireStepUpIfEnabled(ctx context.Context, accountID string, code string) error {
	account, err := s.repo.GetAccountByID(ctx, accountID)
	if err != nil {
		return service.NewError(service.ErrorCodeUnauthorized, "account not found")
	}
	if !account.TwoFAEnabled {
		return nil
	}

	if strings.TrimSpace(code) == "" {
		return service.NewError(service.ErrorCodeTwoFARequired, "two-factor code is required")
	}

	secret, err := s.repo.GetTwoFactorSecret(ctx, accountID)
	if err != nil || !secret.IsEnabled {
		return service.NewError(service.ErrorCodeTwoFARequired, "two-factor setup missing")
	}

	decryptedSecret, err := security.DecryptSecret(secret.EncryptedSecret, secret.Nonce, s.cfg.Security.EncryptionKey)
	if err != nil {
		return service.NewError(service.ErrorCodeInternal, "failed to decrypt two-factor secret")
	}
	if !security.VerifyTOTP(decryptedSecret, code) {
		return service.NewError(service.ErrorCodeUnauthorized, "invalid two-factor code")
	}

	return nil
}

func (s *Service) issueSession(ctx context.Context, accountID string, deviceID string, userAgent string, ipAddress string) (domain.Session, TokenPair, error) {
	return s.issueSessionWithOptions(ctx, accountID, deviceID, userAgent, ipAddress, SessionIssueOptions{
		ClientPlatform: domain.ClientPlatformDesktopTauri,
		SessionClass:   domain.SessionClassDevice,
		Persistent:     true,
	})
}

func (s *Service) issueSessionWithOptions(
	ctx context.Context,
	accountID string,
	deviceID string,
	userAgent string,
	ipAddress string,
	options SessionIssueOptions,
) (domain.Session, TokenPair, error) {
	accessToken, err := security.GenerateOpaqueToken("acc_")
	if err != nil {
		return domain.Session{}, TokenPair{}, service.NewError(service.ErrorCodeInternal, "failed to issue access token")
	}
	refreshToken, err := security.GenerateOpaqueToken("ref_")
	if err != nil {
		return domain.Session{}, TokenPair{}, service.NewError(service.ErrorCodeInternal, "failed to issue refresh token")
	}

	accessExpiresAt := time.Now().UTC().Add(s.cfg.Auth.AccessTokenTTL)
	refreshExpiresAt := time.Now().UTC().Add(s.cfg.Auth.RefreshTokenTTL)

	sessionRecord, err := s.repo.CreateSession(ctx, domain.Session{
		ID:                    security.NewID(),
		AccountID:             accountID,
		DeviceID:              deviceID,
		ClientPlatform:        options.ClientPlatform,
		SessionClass:          options.SessionClass,
		Persistent:            options.Persistent,
		AccessTokenHash:       security.HashToken(accessToken, s.cfg.Auth.TokenPepper),
		RefreshTokenHash:      security.HashToken(refreshToken, s.cfg.Auth.TokenPepper),
		Status:                domain.SessionStatusActive,
		AccessTokenExpiresAt:  accessExpiresAt,
		RefreshTokenExpiresAt: refreshExpiresAt,
	}, userAgent, ipAddress)
	if err != nil {
		return domain.Session{}, TokenPair{}, service.NewError(service.ErrorCodeInternal, "failed to persist session")
	}

	return sessionRecord, TokenPair{
		AccessToken:           accessToken,
		RefreshToken:          refreshToken,
		AccessTokenExpiresAt:  accessExpiresAt,
		RefreshTokenExpiresAt: refreshExpiresAt,
	}, nil
}

func (s *Service) generateRecoveryCodes(accountID string, count int) ([]string, []domain.RecoveryCode, error) {
	plain := make([]string, 0, count)
	models := make([]domain.RecoveryCode, 0, count)

	for i := 0; i < count; i++ {
		token, err := security.GenerateOpaqueToken("rc_")
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate recovery code: %w", err)
		}
		code := strings.ToUpper(strings.ReplaceAll(token[3:15], "-", ""))
		hash := security.HashToken(code, s.cfg.Auth.TokenPepper)
		plain = append(plain, code)
		models = append(models, domain.RecoveryCode{
			ID:        security.NewID(),
			AccountID: accountID,
			CodeHash:  hash,
			CreatedAt: time.Now().UTC(),
		})
	}

	return plain, models, nil
}

func (s *Service) resolveWebSessionIssueOptions(rawPersistence string) SessionIssueOptions {
	persistence := strings.ToLower(strings.TrimSpace(rawPersistence))
	if persistence == "" {
		persistence = s.cfg.WebSession.DefaultPersistence
	}
	persistent := persistence == "remembered" && s.cfg.WebSession.AllowRemembered
	return SessionIssueOptions{
		ClientPlatform: domain.ClientPlatformWebBrowser,
		SessionClass:   domain.SessionClassBrowser,
		Persistent:     persistent,
	}
}
