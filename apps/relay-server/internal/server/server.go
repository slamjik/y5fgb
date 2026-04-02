package server

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/migrations"
	"github.com/example/secure-messenger/apps/relay-server/internal/repository/postgres"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/auth"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/devices"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/messaging"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/recovery"
	"github.com/example/secure-messenger/apps/relay-server/internal/service/securityevents"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport"
	"github.com/example/secure-messenger/apps/relay-server/internal/transport/middleware"
)

type RelayServer struct {
	cfg        config.Config
	logger     *slog.Logger
	httpServer *http.Server
	repo       *postgres.Store
}

func New(cfg config.Config, logger *slog.Logger) (*RelayServer, error) {
	ctx := context.Background()

	repo, err := postgres.New(ctx, cfg.Database.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize postgres repository: %w", err)
	}

	if cfg.RunMigrationsOnStart {
		if err := migrations.Up(ctx, repo.Pool()); err != nil {
			repo.Close()
			return nil, fmt.Errorf("failed to run migrations: %w", err)
		}
	}

	eventService := securityevents.New(repo)
	authService := auth.New(cfg, repo, eventService)
	deviceService := devices.New(repo, authService, eventService, cfg.Auth.TokenPepper)
	recoveryService := recovery.New(repo, authService, eventService, cfg.Auth.TokenPepper)
	messagingService := messaging.New(cfg, repo, eventService, logger)
	wsNotifier := transport.NewWSNotifier(logger)
	messagingService.SetNotifier(wsNotifier)

	mux := http.NewServeMux()
	transport.RegisterRoutes(mux, cfg, logger, transport.Dependencies{
		AuthService:      authService,
		DeviceService:    deviceService,
		RecoveryService:  recoveryService,
		EventService:     eventService,
		MessagingService: messagingService,
		WSNotifier:       wsNotifier,
		DBPing:           repo.Ping,
	})

	addr := net.JoinHostPort(cfg.HTTP.Host, strconv.Itoa(cfg.HTTP.Port))
	hardeningChain := middleware.SecurityHeaders(middleware.RequestID(middleware.BodyLimit(32<<20, mux)))
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      hardeningChain,
		ReadTimeout:  cfg.HTTP.ReadTimeout,
		WriteTimeout: cfg.HTTP.WriteTimeout,
		IdleTimeout:  cfg.HTTP.IdleTimeout,
	}

	return &RelayServer{
		cfg:        cfg,
		logger:     logger,
		httpServer: httpServer,
		repo:       repo,
	}, nil
}

func (s *RelayServer) Start() error {
	s.logger.Info("starting relay server",
		"addr", s.httpServer.Addr,
		"health_path", s.cfg.HTTP.HealthPath,
		"ready_path", s.cfg.HTTP.ReadyPath,
		"ws_path", s.cfg.HTTP.WebSocketPath,
		"api_prefix", s.cfg.HTTP.APIPrefix,
	)

	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("listen and serve failed: %w", err)
	}

	return nil
}

func (s *RelayServer) Shutdown(ctx context.Context) error {
	defer s.repo.Close()
	return s.httpServer.Shutdown(ctx)
}
