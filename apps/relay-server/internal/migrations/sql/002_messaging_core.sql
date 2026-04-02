CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NULL,
  created_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  default_ttl_seconds INTEGER NOT NULL DEFAULT 0,
  allow_ttl_override BOOLEAN NOT NULL DEFAULT TRUE,
  last_server_sequence BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON conversations(created_by_account_id);

CREATE TABLE IF NOT EXISTS direct_conversations (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  account_a_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  CHECK (account_a_id <> account_b_id),
  UNIQUE (account_a_id, account_b_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_conversations_account_a ON direct_conversations(account_a_id);
CREATE INDEX IF NOT EXISTS idx_direct_conversations_account_b ON direct_conversations(account_b_id);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (conversation_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_account ON conversation_members(account_id);

CREATE TABLE IF NOT EXISTS message_envelopes (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  crypto_version INTEGER NOT NULL DEFAULT 1,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  reply_to_message_id UUID NULL REFERENCES message_envelopes(id),
  ttl_seconds INTEGER NULL,
  expires_at TIMESTAMPTZ NULL,
  server_sequence BIGSERIAL NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  UNIQUE (sender_device_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_message_envelopes_conversation_sequence ON message_envelopes(conversation_id, server_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_message_envelopes_sender_device ON message_envelopes(sender_device_id);
CREATE INDEX IF NOT EXISTS idx_message_envelopes_expires_at ON message_envelopes(expires_at);

CREATE TABLE IF NOT EXISTS message_recipients (
  message_id UUID NOT NULL REFERENCES message_envelopes(id) ON DELETE CASCADE,
  recipient_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  wrapped_key TEXT NOT NULL,
  key_algorithm TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'queued',
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ NULL,
  failed_reason TEXT NULL,
  PRIMARY KEY (message_id, recipient_device_id)
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_device_state ON message_recipients(recipient_device_id, delivery_state);
CREATE INDEX IF NOT EXISTS idx_message_recipients_account ON message_recipients(recipient_account_id);

CREATE TABLE IF NOT EXISTS message_receipts (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES message_envelopes(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  receipt_type TEXT NOT NULL,
  sequence BIGSERIAL NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, device_id, receipt_type)
);

CREATE INDEX IF NOT EXISTS idx_message_receipts_message ON message_receipts(message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachment_objects (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  nonce TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  message_id UUID NULL REFERENCES message_envelopes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_attachment_objects_account ON attachment_objects(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachment_objects_message ON attachment_objects(message_id);
CREATE INDEX IF NOT EXISTS idx_attachment_objects_expires_at ON attachment_objects(expires_at);

CREATE TABLE IF NOT EXISTS attachment_refs (
  message_id UUID NOT NULL REFERENCES message_envelopes(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachment_objects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS device_sync_cursors (
  cursor_id UUID PRIMARY KEY,
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  last_cursor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transport_endpoints (
  id UUID PRIMARY KEY,
  url TEXT NOT NULL,
  mode TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_endpoints_priority ON transport_endpoints(priority, enabled DESC);
