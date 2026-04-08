DROP INDEX IF EXISTS idx_media_objects_owner_checksum_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_objects_owner_domain_kind_checksum_active
  ON media_objects(owner_account_id, domain, kind, checksum_sha256)
  WHERE deleted_at IS NULL;
