CREATE TABLE IF NOT EXISTS nft_holdings (
  chain_id              INTEGER NOT NULL,
  contract_address      VARCHAR(42) NOT NULL,
  token_id              NUMERIC(78, 0) NOT NULL,
  token_standard        VARCHAR(8) NOT NULL CHECK (token_standard IN ('ERC721','ERC1155')),
  owner_address         VARCHAR(42) NOT NULL,
  amount                NUMERIC(78, 0) NOT NULL DEFAULT 1,
  metadata_uri          TEXT,
  name                  TEXT,
  image_url             TEXT,
  metadata_fetch_status VARCHAR(16) NOT NULL DEFAULT 'pending'
                          CHECK (metadata_fetch_status IN ('pending','fetching','ok','failed','unsupported')),
  metadata_fetched_at   TIMESTAMPTZ,
  last_transfer_block   BIGINT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, contract_address, token_id, owner_address)
);

CREATE INDEX IF NOT EXISTS idx_nft_holdings_owner
  ON nft_holdings (chain_id, owner_address, updated_at DESC)
  WHERE amount > 0;

CREATE INDEX IF NOT EXISTS idx_nft_holdings_metadata_pending
  ON nft_holdings (chain_id, metadata_fetch_status)
  WHERE metadata_fetch_status = 'pending' AND amount > 0;
