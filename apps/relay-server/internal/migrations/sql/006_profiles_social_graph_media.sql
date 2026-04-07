CREATE TABLE IF NOT EXISTS user_profiles (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  status_text TEXT NOT NULL DEFAULT '',
  birth_date DATE NULL,
  location TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  avatar_media_id UUID NULL,
  banner_media_id UUID NULL,
  username_changed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_username_lower_unique ON user_profiles (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_user_profiles_username_prefix ON user_profiles (username text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name_prefix ON user_profiles (display_name text_pattern_ops);

CREATE TABLE IF NOT EXISTS profile_privacy_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  profile_visibility TEXT NOT NULL DEFAULT 'everyone',
  posts_visibility TEXT NOT NULL DEFAULT 'friends',
  photos_visibility TEXT NOT NULL DEFAULT 'friends',
  stories_visibility TEXT NOT NULL DEFAULT 'friends',
  friends_visibility TEXT NOT NULL DEFAULT 'friends',
  birth_date_visibility TEXT NOT NULL DEFAULT 'friends',
  location_visibility TEXT NOT NULL DEFAULT 'friends',
  links_visibility TEXT NOT NULL DEFAULT 'friends',
  friend_requests_policy TEXT NOT NULL DEFAULT 'everyone',
  dm_policy TEXT NOT NULL DEFAULT 'friends',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_profile_visibility CHECK (profile_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_posts_visibility CHECK (posts_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_photos_visibility CHECK (photos_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_stories_visibility CHECK (stories_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_friends_visibility CHECK (friends_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_birth_visibility CHECK (birth_date_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_location_visibility CHECK (location_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_links_visibility CHECK (links_visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_friend_requests_policy CHECK (friend_requests_policy IN ('everyone', 'friends', 'nobody')),
  CONSTRAINT chk_dm_policy CHECK (dm_policy IN ('everyone', 'friends', 'nobody'))
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY,
  from_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  acted_by UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_friend_request_status CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT chk_friend_request_direction CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_from_account ON friend_requests(from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_account ON friend_requests(to_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  account_a_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_a_id, account_b_id),
  CONSTRAINT chk_friendships_direction CHECK (account_a_id < account_b_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_account_a ON friendships(account_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friendships_account_b ON friendships(account_b_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  CONSTRAINT chk_user_blocks_direction CHECK (blocker_account_id <> blocked_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_objects (
  id UUID PRIMARY KEY,
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_backend TEXT NOT NULL,
  bucket TEXT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  duration_ms BIGINT NULL,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_media_domain CHECK (domain IN ('profile', 'social', 'story')),
  CONSTRAINT chk_media_kind CHECK (kind IN ('avatar', 'banner', 'photo', 'video', 'story_image', 'story_video')),
  CONSTRAINT chk_media_backend CHECK (storage_backend IN ('local', 's3')),
  CONSTRAINT chk_media_visibility CHECK (visibility IN ('everyone', 'friends', 'only_me')),
  CONSTRAINT chk_media_status CHECK (status IN ('active', 'deleted', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_media_objects_owner_domain_created ON media_objects(owner_account_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_objects_expires_at ON media_objects(expires_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_deleted_at ON media_objects(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_objects_owner_checksum_active ON media_objects(owner_account_id, checksum_sha256) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS media_variants (
  media_id UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  variant_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  size_bytes BIGINT NOT NULL,
  PRIMARY KEY (media_id, variant_type),
  CONSTRAINT chk_media_variant_type CHECK (variant_type IN ('thumb', 'preview', 'original'))
);

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY,
  owner_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  caption TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'friends',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_story_visibility CHECK (visibility IN ('everyone', 'friends', 'only_me'))
);

CREATE INDEX IF NOT EXISTS idx_stories_owner_created ON stories(owner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_deleted_at ON stories(deleted_at);

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS media_id UUID NULL REFERENCES media_objects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_media_id ON social_posts(media_id);

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_avatar_media
  FOREIGN KEY (avatar_media_id) REFERENCES media_objects(id) ON DELETE SET NULL;

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_banner_media
  FOREIGN KEY (banner_media_id) REFERENCES media_objects(id) ON DELETE SET NULL;

INSERT INTO user_profiles (
  account_id,
  display_name,
  username,
  bio,
  status_text,
  location,
  website_url,
  created_at,
  updated_at
)
SELECT
  a.id,
  COALESCE(NULLIF(split_part(a.email, '@', 1), ''), 'user'),
  CONCAT(
    COALESCE(NULLIF(LOWER(REGEXP_REPLACE(split_part(a.email, '@', 1), '[^a-zA-Z0-9._-]+', '', 'g')), ''), 'user'),
    '_',
    SUBSTR(REPLACE(a.id::TEXT, '-', ''), 1, 6)
  ),
  '',
  '',
  '',
  '',
  NOW(),
  NOW()
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM user_profiles p WHERE p.account_id = a.id
);

INSERT INTO profile_privacy_settings (
  account_id,
  profile_visibility,
  posts_visibility,
  photos_visibility,
  stories_visibility,
  friends_visibility,
  birth_date_visibility,
  location_visibility,
  links_visibility,
  friend_requests_policy,
  dm_policy,
  updated_at
)
SELECT
  a.id,
  'everyone',
  'friends',
  'friends',
  'friends',
  'friends',
  'friends',
  'friends',
  'friends',
  'everyone',
  'friends',
  NOW()
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM profile_privacy_settings s WHERE s.account_id = a.id
);
