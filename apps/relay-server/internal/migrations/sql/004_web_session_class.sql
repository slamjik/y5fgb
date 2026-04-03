ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client_platform TEXT NOT NULL DEFAULT 'desktop-tauri',
  ADD COLUMN IF NOT EXISTS session_class TEXT NOT NULL DEFAULT 'device',
  ADD COLUMN IF NOT EXISTS persistent BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_sessions_account_session_class ON sessions(account_id, session_class);
