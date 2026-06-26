CREATE TABLE IF NOT EXISTS nft_sync_state (
  chain_id          INTEGER NOT NULL,
  contract_address  VARCHAR(42) NOT NULL,
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address)
);

CREATE INDEX IF NOT EXISTS idx_nft_sync_state_lagging
  ON nft_sync_state (chain_id, last_synced_block);
