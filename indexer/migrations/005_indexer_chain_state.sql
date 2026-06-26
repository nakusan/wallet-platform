CREATE TABLE IF NOT EXISTS indexer_chain_state (
  chain_id                    INTEGER PRIMARY KEY,
  min_indexed_checkpoint      BIGINT NOT NULL DEFAULT 0,
  min_indexed_checkpoint_hash VARCHAR(66),
  finalized_block             BIGINT NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
