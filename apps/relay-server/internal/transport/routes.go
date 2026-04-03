package transport

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/devices"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/messaging"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/recovery"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	apiTransport "github.com/example/secure-messenger/apps/relay-server/internal/transport/api"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
)

type Dependencies struct {
	AuthService      *auth.Service
	DeviceService    *devices.Service
	RecoveryService  *recovery.Service
	EventService     *securityevents.Service
	MessagingService *messaging.Service
	WSNotifier       *WSNotifier
	DBPing           func(context.Context) error
}

func RegisterRoutes(mux *http.ServeMux, cfg config.Config, logger *slog.Logger, deps Dependencies) {
	originPolicy := middleware.NewOriginPolicy(cfg.WebSecurity)

	mux.HandleFunc(cfg.HTTP.HealthPath, HealthHandler())
	mux.HandleFunc(cfg.HTTP.ReadyPath, ReadyHandler(deps.DBPing))
	mux.Handle(
		cfg.HTTP.WebSocketPath,
		NewWebSocketHandler(logger, deps.AuthService, deps.WSNotifier, cfg.Transport.WSQueryTokenFallback, originPolicy),
	)

	apiHandler := apiTransport.NewHandler(logger, deps.AuthService, deps.DeviceService, deps.RecoveryService, deps.EventService, deps.MessagingService, cfg)
	apiTransport.RegisterRoutes(mux, cfg.HTTP.APIPrefix, apiHandler, deps.AuthService)
}
