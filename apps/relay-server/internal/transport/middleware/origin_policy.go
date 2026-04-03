package middleware

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
)

type OriginPolicy struct {
	allowedOrigins    map[string]struct{}
	allowTauriOrigin  bool
	allowNullOrigin   bool
	allowLocalhost    bool
	allowLocalhostSub bool
}

func NewOriginPolicy(cfg config.WebSecurityConfig) OriginPolicy {
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		normalized, ok := normalizeOrigin(origin)
		if !ok {
			continue
		}
		allowed[normalized] = struct{}{}
	}

	return OriginPolicy{
		allowedOrigins:    allowed,
		allowTauriOrigin:  cfg.AllowTauriOrigin,
		allowNullOrigin:   cfg.AllowNullOrigin,
		allowLocalhost:    cfg.AllowLocalhost,
		allowLocalhostSub: cfg.AllowLocalhostSubd,
	}
}

func (p OriginPolicy) Allows(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" || origin == "null" {
		return p.allowNullOrigin
	}
	if origin == "tauri://localhost" {
		return p.allowTauriOrigin
	}

	normalized, ok := normalizeOrigin(origin)
	if !ok {
		return false
	}

	if _, exists := p.allowedOrigins[normalized]; exists {
		return true
	}

	host, ok := hostnameFromOrigin(normalized)
	if !ok {
		return false
	}

	if p.allowLocalhost && (host == "localhost" || host == "127.0.0.1") {
		return true
	}

	if p.allowLocalhostSub && strings.HasSuffix(host, ".localhost") {
		return true
	}

	return false
}

func normalizeOrigin(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.Host == "" {
		return "", false
	}

	scheme := strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Host)
	return fmt.Sprintf("%s://%s", scheme, host), true
}

func hostnameFromOrigin(origin string) (string, bool) {
	parsed, err := url.Parse(origin)
	if err != nil {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", false
	}
	return host, true
}
