ALTER TABLE message_envelopes
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID NULL REFERENCES message_envelopes(id);

CREATE INDEX IF NOT EXISTS idx_message_envelopes_forwarded_from
  ON message_envelopes(forwarded_from_message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL REFERENCES message_envelopes(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, emoji, account_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_account
  ON message_reactions(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_hidden_for_accounts (
  message_id UUID NOT NULL REFERENCES message_envelopes(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_message_hidden_for_accounts_account
  ON message_hidden_for_accounts(account_id, hidden_at DESC);