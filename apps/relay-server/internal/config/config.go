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
	defaultMediaStorageBackend   = "local"
	defaultMediaLocalDir         = "./data/media"
	defaultMediaStoryTTLHrs      = 24
	defaultMediaSoftDeleteHrs    = 72
	defaultMediaCleanupMinutes   = 30
	defaultMediaMaxAvatarBytes   = int64(5 * 1024 * 1024)
	defaultMediaMaxBannerBytes   = int64(10 * 1024 * 1024)
	defaultMediaMaxPhotoBytes    = int64(12 * 1024 * 1024)
	defaultMediaMaxVideoBytes    = int64(64 * 1024 * 1024)
	defaultMediaLocalMaxTotal    = int64(4 * 1024 * 1024 * 1024)
	defaultMediaLocalMaxPerUser  = int64(512 * 1024 * 1024)
	defaultLongPollTimeoutSec    = 25
	defaultReconnectBackoffMinMS = 500
	defaultReconnectBackoffMaxMS = 10000
	defaultAllowTauriOrigin      = true
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
	Media                MediaConfig
	Transport            TransportConfig
	WebSecurity          WebSecurityConfig
	WebSession           WebSessionConfig
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

type MediaConfig struct {
	StorageBackend       string
	LocalDir             string
	LocalMaxTotalBytes   int64
	LocalMaxPerUserBytes int64
	MaxAvatarBytes       int64
	MaxBannerBytes       int64
	MaxPhotoBytes        int64
	MaxVideoBytes        int64
	StoryTTL             time.Duration
	SoftDeleteRetention  time.Duration
	CleanupInterval      time.Duration
	S3Endpoint           string
	S3Region             string
	S3Bucket             string
	S3AccessKey          string
	S3SecretKey          string
	S3ForcePathStyle     bool
	S3PublicBaseURL      string
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

type WebSecurityConfig struct {
	AllowedOrigins     []string
	AllowTauriOrigin   bool
	AllowNullOrigin    bool
	AllowLocalhost     bool
	AllowLocalhostSubd bool
	TrustProxyHeaders  bool
}

type WebSessionConfig struct {
	DefaultPersistence string
	AllowRemembered    bool
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
	mediaStoryTTLHrs, err := getEnvAsInt("MEDIA_STORY_TTL_HOURS", defaultMediaStoryTTLHrs)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_STORY_TTL_HOURS: %w", err)
	}
	mediaSoftDeleteHrs, err := getEnvAsInt("MEDIA_SOFT_DELETE_RETENTION_HOURS", defaultMediaSoftDeleteHrs)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_SOFT_DELETE_RETENTION_HOURS: %w", err)
	}
	mediaCleanupMinutes, err := getEnvAsInt("MEDIA_CLEANUP_INTERVAL_MINUTES", defaultMediaCleanupMinutes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_CLEANUP_INTERVAL_MINUTES: %w", err)
	}
	mediaLocalMaxTotal, err := getEnvAsInt64("MEDIA_LOCAL_MAX_TOTAL_BYTES", defaultMediaLocalMaxTotal)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_LOCAL_MAX_TOTAL_BYTES: %w", err)
	}
	mediaLocalMaxPerUser, err := getEnvAsInt64("MEDIA_LOCAL_MAX_PER_USER_BYTES", defaultMediaLocalMaxPerUser)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_LOCAL_MAX_PER_USER_BYTES: %w", err)
	}
	mediaMaxAvatarBytes, err := getEnvAsInt64("MEDIA_MAX_AVATAR_BYTES", defaultMediaMaxAvatarBytes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_MAX_AVATAR_BYTES: %w", err)
	}
	mediaMaxBannerBytes, err := getEnvAsInt64("MEDIA_MAX_BANNER_BYTES", defaultMediaMaxBannerBytes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_MAX_BANNER_BYTES: %w", err)
	}
	mediaMaxPhotoBytes, err := getEnvAsInt64("MEDIA_MAX_PHOTO_BYTES", defaultMediaMaxPhotoBytes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_MAX_PHOTO_BYTES: %w", err)
	}
	mediaMaxVideoBytes, err := getEnvAsInt64("MEDIA_MAX_VIDEO_BYTES", defaultMediaMaxVideoBytes)
	if err != nil {
		return Config{}, fmt.Errorf("invalid MEDIA_MAX_VIDEO_BYTES: %w", err)
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
	allowNullOriginDefault := env == EnvDevelopment
	allowLocalhostDefault := env == EnvDevelopment

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
		Media: MediaConfig{
			StorageBackend:       strings.ToLower(strings.TrimSpace(getEnv("MEDIA_STORAGE_BACKEND", defaultMediaStorageBackend))),
			LocalDir:             getEnv("MEDIA_LOCAL_DIR", defaultMediaLocalDir),
			LocalMaxTotalBytes:   mediaLocalMaxTotal,
			LocalMaxPerUserBytes: mediaLocalMaxPerUser,
			MaxAvatarBytes:       mediaMaxAvatarBytes,
			MaxBannerBytes:       mediaMaxBannerBytes,
			MaxPhotoBytes:        mediaMaxPhotoBytes,
			MaxVideoBytes:        mediaMaxVideoBytes,
			StoryTTL:             time.Duration(mediaStoryTTLHrs) * time.Hour,
			SoftDeleteRetention:  time.Duration(mediaSoftDeleteHrs) * time.Hour,
			CleanupInterval:      time.Duration(mediaCleanupMinutes) * time.Minute,
			S3Endpoint:           getEnv("MEDIA_S3_ENDPOINT", ""),
			S3Region:             getEnv("MEDIA_S3_REGION", ""),
			S3Bucket:             getEnv("MEDIA_S3_BUCKET", ""),
			S3AccessKey:          getEnv("MEDIA_S3_ACCESS_KEY", ""),
			S3SecretKey:          getEnv("MEDIA_S3_SECRET_KEY", ""),
			S3ForcePathStyle:     getEnvAsBool("MEDIA_S3_FORCE_PATH_STYLE", true),
			S3PublicBaseURL:      getEnv("MEDIA_S3_PUBLIC_BASE_URL", ""),
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
		WebSecurity: WebSecurityConfig{
			AllowedOrigins:     splitCSV(getEnv("WEB_ALLOWED_ORIGINS", "")),
			AllowTauriOrigin:   getEnvAsBool("WEB_ALLOW_TAURI_ORIGIN", defaultAllowTauriOrigin),
			AllowNullOrigin:    getEnvAsBool("WEB_ALLOW_NULL_ORIGIN", allowNullOriginDefault),
			AllowLocalhost:     getEnvAsBool("WEB_ALLOW_LOCALHOST_ORIGIN", allowLocalhostDefault),
			AllowLocalhostSubd: getEnvAsBool("WEB_ALLOW_LOCALHOST_SUBDOMAINS", allowLocalhostDefault),
			TrustProxyHeaders:  getEnvAsBool("WEB_TRUST_PROXY_HEADERS", env == EnvProduction),
		},
		WebSession: WebSessionConfig{
			DefaultPersistence: strings.ToLower(strings.TrimSpace(getEnv("WEB_SESSION_DEFAULT_PERSISTENCE", "ephemeral"))),
			AllowRemembered:    getEnvAsBool("WEB_SESSION_ALLOW_REMEMBERED", true),
		},
	}

	if cfg.WebSession.DefaultPersistence != "ephemeral" && cfg.WebSession.DefaultPersistence != "remembered" {
		return Config{}, fmt.Errorf("WEB_SESSION_DEFAULT_PERSISTENCE must be ephemeral or remembered")
	}
	if cfg.WebSession.DefaultPersistence == "remembered" && !cfg.WebSession.AllowRemembered {
		cfg.WebSession.DefaultPersistence = "ephemeral"
	}
	if cfg.Media.StorageBackend != "local" && cfg.Media.StorageBackend != "s3" {
		return Config{}, fmt.Errorf("MEDIA_STORAGE_BACKEND must be local or s3")
	}
	if cfg.Media.StorageBackend == "s3" {
		if strings.TrimSpace(cfg.Media.S3Bucket) == "" {
			return Config{}, fmt.Errorf("MEDIA_S3_BUCKET is required when MEDIA_STORAGE_BACKEND=s3")
		}
		if strings.TrimSpace(cfg.Media.S3Region) == "" {
			cfg.Media.S3Region = "auto"
		}
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
