CREATE TABLE IF NOT EXISTS account_notification_state (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  read_before TIMESTAMPTZ NULL,
  cleared_before TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_notification_read_marks (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_account_notification_read_marks_account_read_at
  ON account_notification_read_marks(account_id, read_at DESC);
