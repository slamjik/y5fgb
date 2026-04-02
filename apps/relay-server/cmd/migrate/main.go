package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/example/secure-messenger/apps/relay-server/internal/config"
	"github.com/example/secure-messenger/apps/relay-server/internal/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	mode := flag.String("mode", "up", "migration mode: up or down")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.Database.URL)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "failed to connect database: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	switch *mode {
	case "up":
		if err := migrations.Up(ctx, pool); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "failed to apply migrations: %v\n", err)
			os.Exit(1)
		}
		_, _ = fmt.Fprintln(os.Stdout, "migrations up applied")
	case "down":
		if err := migrations.Down(ctx, pool); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "failed to rollback migrations: %v\n", err)
			os.Exit(1)
		}
		_, _ = fmt.Fprintln(os.Stdout, "migrations down applied")
	default:
		_, _ = fmt.Fprintf(os.Stderr, "invalid mode: %s (expected up|down)\n", *mode)
		os.Exit(1)
	}
}
