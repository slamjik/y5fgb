package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHTTPHost              = "0.0.0.0"
	defaultHTTPPort              = 8080
	defaultLogLevel              = "info"
	defaultReadTimeoutSec        = 10
	defaultWriteTimeoutSec       = 10
	defaultIdleTimeoutSec        = 60
	defaultShutdownSec           = 10
	defaultAccessTokenTTLMin     = 15
	defaultRefreshTokenTTLHours  = 24 * 30
	defaultTwoFAChallengeMin     = 5
	defaultAttachmentsDir        = "./data/attachments"
	defaultAttachmentMaxBytes    = int64(20 * 1024 * 1024)
	defaultAttachmentTTLHours    = 24
	defaultLongPollTimeoutSec    = 25
	defaultReconnectBackoffMinMS = 500
	defaultReconnectBackoffMaxMS = 10000
)

type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvProduction  Environment = "production"
)

type Config struct {
	Environment          Environment
	LogLevel             string
	RunMigrationsOnStart bool
	HTTP                 HTTPConfig
	Database             DatabaseConfig
	Auth                 AuthConfig
	Security             SecurityConfig
	Messaging            MessagingConfig
	Transport            TransportConfig
}

type HTTPConfig struct {
	Host            string
	Port            int
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
	WebSocketPath   string
	HealthPath      string
	ReadyPath       string
	APIPrefix       string
}

type DatabaseConfig struct {
	URL string
}

type AuthConfig struct {
	TokenPepper       string
	AccessTokenTTL    time.Duration
	RefreshTokenTTL   time.Duration
	TwoFAChallengeTTL time.Duration
	Issuer            string
}

type SecurityConfig struct {
	EncryptionKey []byte
}

type MessagingConfig struct {
	AttachmentsDir         string
	AttachmentMaxSizeBytes int64
	UnattachedRetention    time.Duration
}

type TransportConfig struct {
	PrimaryWebSocketEndpoint string
	AlternateEndpoints       []string
	WSQueryTokenFallback     bool
	LongPollEnabled          bool
	LongPollTimeout          time.Duration
	ReconnectBackoffMin      time.Duration
	ReconnectBackoffMax      time.Duration
}

func Load() (Config, error) {
	env := Environment(getEnv("APP_ENV", string(EnvDevelopment)))
	if env != EnvDevelopment && env != EnvProduction {
		return Config{}, fmt.Errorf("invalid APP_ENV: %s", env)
	}

	httpPort, err := getEnvAsInt("HTTP_PORT", defaultHTTPPort)
	if err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_PORT: %w", err)
	}

	readTimeoutSec, err := getEnvAsInt("HTTP_READ_TIMEOUT_SEC", defaultReadTimeoutSec)
	if err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_READ_TIMEOUT_SEC: %w", err)
	}

	writeTimeoutSec, err := getEnvAsInt("HTTP_WRITE_TIMEOUT_SEC", defaultWriteTimeoutSec)
	if err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_WRITE_TIMEOUT_SEC: %w", err)
	}

	idleTimeoutSec, err := getEnvAsInt("HTTP_IDLE_TIMEOUT_SEC", defaultIdleTimeoutSec)
	if err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_IDLE_TIMEOUT_SEC: %w", err)
	}

	shutdownSec, err := getEnvAsInt("HTTP_SHUTDOWN_TIMEOUT_SEC", defaultShutdownSec)
	if err != nil {
		return Config{}, fmt.Errorf("invalid HTTP_SHUTDOWN_TIMEOUT_SEC: %w", err)
	}

	accessTTLMin, err := getEnvAsInt("AUTH_ACCESS_TOKEN_TTL_MIN", defaultAccessTokenTTLMin)
	if err != nil {
		return Config{}, fmt.Errorf("invalid AUTH_ACCESS_TOKEN_TTL_MIN: %w", err)
	}

	refreshTTLHours, err := getEnvAsInt("AUTH_REFRESH_TOKEN_TTL_HOURS", defaultRefreshTokenTTLHours)
	if err != nil {
		return Config{}, fmt.Errorf("invalid AUTH_REFRESH_TOKEN_TTL_HOURS: %w", err)
	}

	twoFAChallengeMin, err := getEnvAsInt("AUTH_2FA_CHALLENGE_TTL_MIN", defaultTwoFAChallengeMin)
	if err != nil {
		return Config{}, fmt.Errorf("invalid AUTH_2FA_CHALLENGE_TTL_MIN: %w", err)
	}

	attachmentMaxBytes, err := getEnvAsInt64("MESSAGING_ATTACHMENT_MAX_BYTES", defaultAttachmentMaxBytes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MESSAGING_ATTACHMENT_MAX_BYTES: %w", err)
	}
	attachmentTTLHrs, err := getEnvAsInt("MESSAGING_UNATTACHED_TTL_HOURS", defaultAttachmentTTLHours)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MESSAGING_UNATTACHED_TTL_HOURS: %w", err)
	}
	longPollTimeoutSec, err := getEnvAsInt("TRANSPORT_LONG_POLL_TIMEOUT_SEC", defaultLongPollTimeoutSec)
	if err != nil {
		return Config{}, fmt.Errorf("invalid TRANSPORT_LONG_POLL_TIMEOUT_SEC: %w", err)
	}
	reconnectBackoffMinMS, err := getEnvAsInt("TRANSPORT_RECONNECT_BACKOFF_MIN_MS", defaultReconnectBackoffMinMS)
	if err != nil {
		return Config{}, fmt.Errorf("invalid TRANSPORT_RECONNECT_BACKOFF_MIN_MS: %w", err)
	}
	reconnectBackoffMaxMS, err := getEnvAsInt("TRANSPORT_RECONNECT_BACKOFF_MAX_MS", defaultReconnectBackoffMaxMS)
	if err != nil {
		return Config{}, fmt.Errorf("invalid TRANSPORT_RECONNECT_BACKOFF_MAX_MS: %w", err)
	}
	if reconnectBackoffMinMS <= 0 {
		reconnectBackoffMinMS = defaultReconnectBackoffMinMS
	}
	if reconnectBackoffMaxMS < reconnectBackoffMinMS {
		reconnectBackoffMaxMS = reconnectBackoffMinMS * 2
	}
	if longPollTimeoutSec <= 0 || longPollTimeoutSec > 60 {
		longPollTimeoutSec = defaultLongPollTimeoutSec
	}
	if attachmentMaxBytes <= 0 {
		attachmentMaxBytes = defaultAttachmentMaxBytes
	}

	tokenPepper := getEnv("AUTH_TOKEN_PEPPER", "")
	if tokenPepper == "" {
		return Config{}, fmt.Errorf("AUTH_TOKEN_PEPPER is required")
	}
	if env == EnvProduction {
		if len(tokenPepper) < 16 {
			return Config{}, fmt.Errorf("AUTH_TOKEN_PEPPER must be at least 16 chars in production")
		}
		if strings.Contains(strings.ToLower(tokenPepper), "dev") {
			return Config{}, fmt.Errorf("AUTH_TOKEN_PEPPER cannot contain dev-style values in production")
		}
	}

	encryptionKeyRaw := getEnv("SECURITY_ENCRYPTION_KEY", "")
	if encryptionKeyRaw == "" {
		return Config{}, fmt.Errorf("SECURITY_ENCRYPTION_KEY is required")
	}

	encryptionKey, err := decodeEncryptionKey(encryptionKeyRaw)
	if err != nil {
		return Config{}, err
	}

	wsQueryFallbackDefault := env == EnvDevelopment

	cfg := Config{
		Environment:          env,
		LogLevel:             getEnv("LOG_LEVEL", defaultLogLevel),
		RunMigrationsOnStart: getEnvAsBool("RUN_MIGRATIONS_ON_START", true),
		HTTP: HTTPConfig{
			Host:            getEnv("HTTP_HOST", defaultHTTPHost),
			Port:            httpPort,
			ReadTimeout:     time.Duration(readTimeoutSec) * time.Second,
			WriteTimeout:    time.Duration(writeTimeoutSec) * time.Second,
			IdleTimeout:     time.Duration(idleTimeoutSec) * time.Second,
			ShutdownTimeout: time.Duration(shutdownSec) * time.Second,
			WebSocketPath:   getEnv("WS_PATH", "/ws"),
			HealthPath:      getEnv("HEALTH_PATH", "/health"),
			ReadyPath:       getEnv("READY_PATH", "/ready"),
			APIPrefix:       getEnv("API_PREFIX", "/api/v1"),
		},
		Database: DatabaseConfig{
			URL: getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/secure_messenger?sslmode=disable"),
		},
		Auth: AuthConfig{
			TokenPepper:       tokenPepper,
			AccessTokenTTL:    time.Duration(accessTTLMin) * time.Minute,
			RefreshTokenTTL:   time.Duration(refreshTTLHours) * time.Hour,
			TwoFAChallengeTTL: time.Duration(twoFAChallengeMin) * time.Minute,
			Issuer:            getEnv("AUTH_2FA_ISSUER", "SecureMessenger"),
		},
		Security: SecurityConfig{
			EncryptionKey: encryptionKey,
		},
		Messaging: MessagingConfig{
			AttachmentsDir:         getEnv("MESSAGING_ATTACHMENTS_DIR", defaultAttachmentsDir),
			AttachmentMaxSizeBytes: attachmentMaxBytes,
			UnattachedRetention:    time.Duration(attachmentTTLHrs) * time.Hour,
		},
		Transport: TransportConfig{
			PrimaryWebSocketEndpoint: getEnv("TRANSPORT_PRIMARY_WS_ENDPOINT", ""),
			AlternateEndpoints:       splitCSV(getEnv("TRANSPORT_ALTERNATE_ENDPOINTS", "")),
			WSQueryTokenFallback:     getEnvAsBool("TRANSPORT_WS_QUERY_TOKEN_FALLBACK", wsQueryFallbackDefault),
			LongPollEnabled:          getEnvAsBool("TRANSPORT_LONG_POLL_ENABLED", true),
			LongPollTimeout:          time.Duration(longPollTimeoutSec) * time.Second,
			ReconnectBackoffMin:      time.Duration(reconnectBackoffMinMS) * time.Millisecond,
			ReconnectBackoffMax:      time.Duration(reconnectBackoffMaxMS) * time.Millisecond,
		},
	}

	return cfg, nil
}

func decodeEncryptionKey(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("SECURITY_ENCRYPTION_KEY must be base64: %w", err)
	}
	if len(decoded) != 32 {
		return nil, fmt.Errorf("SECURITY_ENCRYPTION_KEY must decode to 32 bytes")
	}

	return decoded, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}

func getEnvAsInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, err
	}

	return parsed, nil
}

func getEnvAsInt64(key string, fallback int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, err
	}

	return parsed, nil
}

func getEnvAsBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	switch value {
	case "1", "true", "TRUE", "yes", "YES":
		return true
	case "0", "false", "FALSE", "no", "NO":
		return false
	default:
		return fallback
	}
}

func splitCSV(value string) []string {
	if value == "" {
		return []string{}
	}
	rawParts := strings.Split(value, ",")
	parts := make([]string, 0, len(rawParts))
	for _, raw := range rawParts {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		parts = append(parts, trimmed)
	}
	return parts
}
