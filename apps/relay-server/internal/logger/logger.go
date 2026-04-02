package logger

import (
	"log/slog"
	"os"
	"strings"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
)

func New(cfg config.Config) *slog.Logger {
	logLevel := parseLevel(cfg.LogLevel)
	handlerOptions := &slog.HandlerOptions{
		Level: logLevel,
		ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
			key := strings.ToLower(attr.Key)
			if isSensitiveField(key) {
				return slog.String(attr.Key, "[redacted]")
			}
			return attr
		},
	}

	var handler slog.Handler
	if cfg.Environment == config.EnvProduction {
		handler = slog.NewJSONHandler(os.Stdout, handlerOptions)
	} else {
		handler = slog.NewTextHandler(os.Stdout, handlerOptions)
	}

	return slog.New(handler).With(
		"service", "relay-server",
		"environment", string(cfg.Environment),
	)
}

func isSensitiveField(key string) bool {
	sensitiveKeys := []string{"password", "secret", "token", "private", "key", "ciphertext", "plaintext", "recovery", "nonce"}
	for _, sensitiveKey := range sensitiveKeys {
		if strings.Contains(key, sensitiveKey) {
			return true
		}
	}
	return false
}

func parseLevel(value string) slog.Level {
	switch strings.ToLower(value) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
