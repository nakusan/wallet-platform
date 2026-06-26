CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash    VARCHAR(64) NOT NULL UNIQUE,
  scopes      TEXT[] NOT NULL DEFAULT ARRAY['read:balance','read:tx'],
  rate_limit  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID NOT NULL REFERENCES api_keys(id),
  target_url      TEXT NOT NULL,
  secret          TEXT NOT NULL,
  chain_ids       INTEGER[],
  watch_addresses TEXT[] NOT NULL,
  event_types     TEXT[] NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  event_id        TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  last_status_code INTEGER,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  UNIQUE (subscription_id, event_id)
);
