CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  UUID NOT NULL REFERENCES webhook_subscriptions(id),
  event_id         TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  last_status_code INTEGER,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ,
  UNIQUE (subscription_id, event_id)
);
