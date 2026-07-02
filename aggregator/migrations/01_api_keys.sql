CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash     VARCHAR(64) NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['read:balance','read:tx'],
  rate_limit   INTEGER NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);