CREATE TABLE IF NOT EXISTS address_activities (
  chain_id              INTEGER NOT NULL,
  tx_hash               VARCHAR(66) NOT NULL,
  participant_address   VARCHAR(42) NOT NULL,
  block_number          BIGINT NOT NULL,
  block_timestamp       TIMESTAMPTZ,
  tx_from               VARCHAR(42) NOT NULL,
  tx_to                 VARCHAR(42),
  tx_value_raw          NUMERIC(78, 0) NOT NULL DEFAULT 0,
  tx_status             VARCHAR(8) NOT NULL CHECK (tx_status IN ('success','failed')),
  activity_type         VARCHAR(32) NOT NULL,
  protocol              VARCHAR(32),
  method_selector       VARCHAR(10),
  method_name           TEXT,
  movements             JSONB NOT NULL DEFAULT '[]',
  status                VARCHAR(16) NOT NULL DEFAULT 'indexed'
                          CHECK (status IN ('indexed', 'reorged')),
  enriched_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, tx_hash, participant_address)
);

CREATE INDEX IF NOT EXISTS idx_activity_participant
  ON address_activities (chain_id, participant_address, block_number DESC, tx_hash);
