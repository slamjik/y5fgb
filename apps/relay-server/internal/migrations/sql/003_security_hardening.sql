ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rotation_due_at TIMESTAMPTZ NULL;

UPDATE devices
SET
  key_version = CASE WHEN key_version < 1 THEN 1 ELSE key_version END,
  rotated_at = COALESCE(rotated_at, created_at),
  rotation_due_at = COALESCE(rotation_due_at, created_at + INTERVAL '180 days')
WHERE TRUE;
