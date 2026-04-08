package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/service"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/google/uuid"
)

type contextKey string

const (
	requestIDKey contextKey = "request_id"
	authKey      contextKey = "auth_principal"
)

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}

func CORS(originPolicy OriginPolicy, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if !originPolicy.Allows(origin) {
				writeError(w, RequestIDFromContext(r.Context()), http.StatusForbidden, service.NewError(service.ErrorCodeForbidden, "origin is not allowed"))
				return
			}

			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func BodyLimit(maxBytes int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && maxBytes > 0 {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func AuthRequired(authService *auth.Service, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if len(authHeader) < len("Bearer ") || authHeader[:7] != "Bearer " {
			writeError(w, RequestIDFromContext(r.Context()), http.StatusUnauthorized, service.NewError(service.ErrorCodeUnauthorized, "missing bearer token"))
			return
		}

		principal, err := authService.AuthenticateAccessToken(r.Context(), authHeader[7:])
		if err != nil {
			status := http.StatusUnauthorized
			if appErr, ok := err.(*service.AppError); ok && appErr.Code == service.ErrorCodeDeviceNotApproved {
				status = http.StatusForbidden
			}
			writeError(w, RequestIDFromContext(r.Context()), status, err)
			return
		}

		ctx := context.WithValue(r.Context(), authKey, *principal)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func RequestIDFromContext(ctx context.Context) string {
	value, ok := ctx.Value(requestIDKey).(string)
	if !ok {
		return ""
	}
	return value
}

func PrincipalFromContext(ctx context.Context) (auth.AuthPrincipal, bool) {
	principal, ok := ctx.Value(authKey).(auth.AuthPrincipal)
	return principal, ok
}

func DecodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("unexpected trailing payload")
		}
		return err
	}
	return nil
}

func writeError(w http.ResponseWriter, requestID string, status int, err error) {
	appErr, ok := err.(*service.AppError)
	if !ok {
		appErr = service.NewError(service.ErrorCodeInternal, "internal server error")
	}

	response := map[string]any{
		"error": map[string]any{
			"code":       appErr.Code,
			"message":    appErr.Message,
			"request_id": requestID,
		},
	}
	if appErr.Details != nil {
		response["error"].(map[string]any)["details"] = appErr.Details
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}

type RateLimitKeyFn func(*http.Request) string

type IPRateLimiter struct {
	mu      sync.Mutex
	window  time.Duration
	limit   int
	keyFn   RateLimitKeyFn
	entries map[string]*rateLimitEntry
}

type rateLimitEntry struct {
	count     int
	windowEnd time.Time
}

func NewIPRateLimiter(limit int, window time.Duration, keyFn RateLimitKeyFn) *IPRateLimiter {
	if keyFn == nil {
		keyFn = defaultRateLimitKey
	}
	return &IPRateLimiter{
		window:  window,
		limit:   limit,
		keyFn:   keyFn,
		entries: make(map[string]*rateLimitEntry),
	}
}

func (rl *IPRateLimiter) Allow(r *http.Request) bool {
	if rl == nil || rl.limit <= 0 || rl.window <= 0 {
		return true
	}

	key := rl.keyFn(r)
	now := time.Now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, exists := rl.entries[key]
	if !exists || now.After(entry.windowEnd) {
		rl.entries[key] = &rateLimitEntry{
			count:     1,
			windowEnd: now.Add(rl.window),
		}
		rl.gc(now)
		return true
	}

	if entry.count >= rl.limit {
		return false
	}

	entry.count += 1
	return true
}

func (rl *IPRateLimiter) gc(now time.Time) {
	for key, entry := range rl.entries {
		if now.After(entry.windowEnd) {
			delete(rl.entries, key)
		}
	}
}

func RateLimitKeyFromRequest(trustProxyHeaders bool) RateLimitKeyFn {
	if trustProxyHeaders {
		return forwardedOrRemoteRateLimitKey
	}
	return remoteRateLimitKey
}

func defaultRateLimitKey(r *http.Request) string {
	return remoteRateLimitKey(r)
}

func forwardedOrRemoteRateLimitKey(r *http.Request) string {
	forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if len(parts) > 0 {
			value := strings.TrimSpace(parts[0])
			if value != "" {
				return value
			}
		}
	}
	return remoteRateLimitKey(r)
}

func remoteRateLimitKey(r *http.Request) string {
	addr := strings.TrimSpace(r.RemoteAddr)
	if addr == "" {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(addr)
	if err == nil && strings.TrimSpace(host) != "" {
		return strings.TrimSpace(host)
	}
	if index := strings.LastIndex(addr, ":"); index != -1 {
		return addr[:index]
	}
	return addr
}
