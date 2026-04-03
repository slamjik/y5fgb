package transport

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	wsWriteTimeout       = 10 * time.Second
	wsPongWait           = 90 * time.Second
	wsPingInterval       = 30 * time.Second
	wsAuthProtocolPrefix = "sm.auth."
	wsRuntimeProtocol    = "sm.v1"
)

type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *wsClient) writeJSON(payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return c.conn.WriteJSON(payload)
}

type WSNotifier struct {
	logger   *slog.Logger
	mu       sync.RWMutex
	byDevice map[string]map[*wsClient]struct{}
}

func NewWSNotifier(logger *slog.Logger) *WSNotifier {
	return &WSNotifier{
		logger:   logger,
		byDevice: make(map[string]map[*wsClient]struct{}),
	}
}

func (n *WSNotifier) register(deviceID string, client *wsClient) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, ok := n.byDevice[deviceID]; !ok {
		n.byDevice[deviceID] = make(map[*wsClient]struct{})
	}
	n.byDevice[deviceID][client] = struct{}{}
}

func (n *WSNotifier) unregister(deviceID string, client *wsClient) {
	n.mu.Lock()
	defer n.mu.Unlock()
	deviceClients, ok := n.byDevice[deviceID]
	if !ok {
		return
	}
	delete(deviceClients, client)
	if len(deviceClients) == 0 {
		delete(n.byDevice, deviceID)
	}
}

func (n *WSNotifier) NotifyDeviceSync(deviceID string, cursor int64) {
	n.mu.RLock()
	deviceClients, ok := n.byDevice[deviceID]
	if !ok {
		n.mu.RUnlock()
		return
	}
	clients := make([]*wsClient, 0, len(deviceClients))
	for client := range deviceClients {
		clients = append(clients, client)
	}
	n.mu.RUnlock()

	payload := map[string]any{
		"direction": "server_to_client",
		"envelope": map[string]any{
			"id":        uuid.NewString(),
			"type":      "server.sync_available",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"payload": map[string]any{
				"deviceId": deviceID,
				"cursor":   cursor,
			},
		},
	}

	for _, client := range clients {
		if err := client.writeJSON(payload); err != nil {
			n.logger.Debug("websocket sync notification write failed", "device_id", deviceID, "error", err)
			n.unregister(deviceID, client)
			_ = client.conn.Close()
		}
	}
}

type webSocketHandler struct {
	logger                  *slog.Logger
	authService             *auth.Service
	notifier                *WSNotifier
	allowQueryTokenFallback bool
	originPolicy            middleware.OriginPolicy
	upgrader                websocket.Upgrader
}

func NewWebSocketHandler(
	logger *slog.Logger,
	authService *auth.Service,
	notifier *WSNotifier,
	allowQueryTokenFallback bool,
	originPolicy middleware.OriginPolicy,
) http.Handler {
	handler := &webSocketHandler{
		logger:                  logger,
		authService:             authService,
		notifier:                notifier,
		allowQueryTokenFallback: allowQueryTokenFallback,
		originPolicy:            originPolicy,
		upgrader:                websocket.Upgrader{},
	}
	handler.upgrader.CheckOrigin = func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		return handler.originPolicy.Allows(origin)
	}
	return handler
}

func (h *webSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	accessToken, tokenSource, acceptedSubprotocol := extractAccessToken(r)
	if strings.TrimSpace(accessToken) == "" {
		writeWSError(w, http.StatusUnauthorized, "missing access token")
		return
	}
	if tokenSource == "query" && !h.allowQueryTokenFallback {
		writeWSError(w, http.StatusUnauthorized, "query token auth is disabled")
		return
	}
	if tokenSource == "query" && h.allowQueryTokenFallback {
		h.logger.Warn("websocket used query-token auth fallback", "remote_addr", r.RemoteAddr)
	}

	principal, err := h.authService.AuthenticateAccessToken(r.Context(), accessToken)
	if err != nil {
		writeWSError(w, http.StatusUnauthorized, "invalid access token")
		return
	}

	responseHeaders := http.Header{}
	if acceptedSubprotocol != "" {
		responseHeaders.Set("Sec-WebSocket-Protocol", acceptedSubprotocol)
	}
	conn, err := h.upgrader.Upgrade(w, r, responseHeaders)
	if err != nil {
		h.logger.Warn("websocket upgrade failed", "error", err)
		return
	}

	client := &wsClient{conn: conn}
	h.notifier.register(principal.DeviceID, client)
	h.logger.Info("websocket client connected", "device_id", principal.DeviceID, "account_id", principal.AccountID, "remote_addr", r.RemoteAddr)

	if err := client.writeJSON(map[string]any{
		"direction": "server_to_client",
		"envelope": map[string]any{
			"id":        uuid.NewString(),
			"type":      "server.hello",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"payload": map[string]any{
				"deviceId":  principal.DeviceID,
				"accountId": principal.AccountID,
			},
		},
	}); err != nil {
		h.notifier.unregister(principal.DeviceID, client)
		_ = conn.Close()
		h.logger.Warn("failed to write websocket hello message", "error", err)
		return
	}

	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(_ string) error {
		_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})

	done := make(chan struct{})
	go h.writePingLoop(client, done)

	for {
		_, payload, readErr := conn.ReadMessage()
		if readErr != nil {
			h.logger.Debug("websocket client read loop ended", "device_id", principal.DeviceID, "error", readErr)
			break
		}

		var incoming map[string]any
		if err := json.Unmarshal(payload, &incoming); err != nil {
			h.logger.Debug("ignored malformed websocket payload", "device_id", principal.DeviceID, "error", err)
			continue
		}
	}

	close(done)
	h.notifier.unregister(principal.DeviceID, client)
	_ = conn.Close()
	h.logger.Info("websocket client disconnected", "device_id", principal.DeviceID, "account_id", principal.AccountID)
}

func (h *webSocketHandler) writePingLoop(client *wsClient, done <-chan struct{}) {
	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			client.mu.Lock()
			_ = client.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			err := client.conn.WriteMessage(websocket.PingMessage, []byte("ping"))
			client.mu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

func extractAccessToken(r *http.Request) (string, string, string) {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:]), "authorization", ""
	}

	offeredProtocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
	authToken := ""
	runtimeProtocolOffered := false
	for _, raw := range offeredProtocols {
		protocol := strings.TrimSpace(raw)
		if protocol == wsRuntimeProtocol {
			runtimeProtocolOffered = true
		}
		if !strings.HasPrefix(protocol, wsAuthProtocolPrefix) {
			continue
		}
		token := strings.TrimSpace(strings.TrimPrefix(protocol, wsAuthProtocolPrefix))
		if token != "" {
			authToken = token
		}
	}
	if authToken != "" {
		acceptedProtocol := ""
		if runtimeProtocolOffered {
			acceptedProtocol = wsRuntimeProtocol
		}
		return authToken, "subprotocol", acceptedProtocol
	}

	queryToken := strings.TrimSpace(r.URL.Query().Get("access_token"))
	if queryToken != "" {
		return queryToken, "query", ""
	}
	return "", "", ""
}

func writeWSError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":    "unauthorized",
			"message": message,
		},
	})
}
