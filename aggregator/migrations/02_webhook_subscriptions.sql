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
