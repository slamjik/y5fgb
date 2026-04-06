CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY,
  author_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_type TEXT NULL,
  media_url TEXT NULL,
  mood TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_social_posts_created_at_desc ON social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_author_account_id ON social_posts(author_account_id);

CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_post_likes_post_id ON social_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_social_post_likes_account_id ON social_post_likes(account_id);
