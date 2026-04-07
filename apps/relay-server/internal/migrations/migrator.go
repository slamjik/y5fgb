package migrations

import (
	"context"
	"embed"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/*.sql
var migrationFS embed.FS

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("failed to ensure schema_migrations table: %w", err)
	}

	entries, err := migrationFS.ReadDir("sql")
	if err != nil {
		return fmt.Errorf("failed to read migration dir: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, ".sql") {
			files = append(files, name)
		}
	}
	sort.Strings(files)

	for _, name := range files {
		version, err := migrationVersion(name)
		if err != nil {
			return err
		}

		var exists bool
		if err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", version).Scan(&exists); err != nil {
			return fmt.Errorf("failed to query migration version %d: %w", version, err)
		}
		if exists {
			continue
		}

		content, err := migrationFS.ReadFile(filepath.ToSlash("sql/" + name))
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", name, err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to start migration tx: %w", err)
		}

		statements := splitStatements(string(content))
		for _, statement := range statements {
			if _, err := tx.Exec(ctx, statement); err != nil {
				_ = tx.Rollback(ctx)
				return fmt.Errorf("failed to apply migration %s: %w", name, err)
			}
		}

		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("failed to register migration %s: %w", name, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", name, err)
		}
	}

	return nil
}

func Down(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin down migration tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	statements := []string{
		`DROP TABLE IF EXISTS stories`,
		`DROP TABLE IF EXISTS user_profiles`,
		`DROP TABLE IF EXISTS media_variants`,
		`DROP TABLE IF EXISTS media_objects`,
		`DROP TABLE IF EXISTS user_blocks`,
		`DROP TABLE IF EXISTS friendships`,
		`DROP TABLE IF EXISTS friend_requests`,
		`DROP TABLE IF EXISTS profile_privacy_settings`,
		`DROP TABLE IF EXISTS social_post_likes`,
		`DROP TABLE IF EXISTS social_posts`,
		`DROP TABLE IF EXISTS transport_endpoints`,
		`DROP TABLE IF EXISTS device_sync_cursors`,
		`DROP TABLE IF EXISTS attachment_refs`,
		`DROP TABLE IF EXISTS attachment_objects`,
		`DROP TABLE IF EXISTS message_receipts`,
		`DROP TABLE IF EXISTS message_recipients`,
		`DROP TABLE IF EXISTS message_envelopes`,
		`DROP TABLE IF EXISTS conversation_members`,
		`DROP TABLE IF EXISTS direct_conversations`,
		`DROP TABLE IF EXISTS conversations`,
		`DROP TABLE IF EXISTS security_events`,
		`DROP TABLE IF EXISTS recovery_flows`,
		`DROP TABLE IF EXISTS recovery_codes`,
		`DROP TABLE IF EXISTS two_factor_challenges`,
		`DROP TABLE IF EXISTS two_factor_secrets`,
		`DROP TABLE IF EXISTS sessions`,
		`DROP TABLE IF EXISTS device_approval_requests`,
		`DROP TABLE IF EXISTS devices`,
		`DROP TABLE IF EXISTS account_identities`,
		`DROP TABLE IF EXISTS accounts`,
		`DROP TABLE IF EXISTS schema_migrations`,
	}

	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("failed to execute down statement %q: %w", statement, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit down migration: %w", err)
	}
	return nil
}

func migrationVersion(filename string) (int64, error) {
	parts := strings.SplitN(filename, "_", 2)
	if len(parts) < 1 {
		return 0, fmt.Errorf("invalid migration filename: %s", filename)
	}

	version, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid migration version in %s: %w", filename, err)
	}

	return version, nil
}

func splitStatements(content string) []string {
	normalized := strings.TrimPrefix(content, "\uFEFF")
	parts := strings.Split(normalized, ";")
	statements := make([]string, 0, len(parts))
	for _, part := range parts {
		statement := strings.TrimSpace(part)
		if statement == "" {
			continue
		}
		statements = append(statements, statement)
	}
	return statements
}
