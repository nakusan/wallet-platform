CREATE TABLE IF NOT EXISTS token_price_sources (
  chain_id          INTEGER NOT NULL,
  contract_address  VARCHAR(42) NOT NULL,
  source            VARCHAR(32) NOT NULL DEFAULT 'coingecko',
  external_id       TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, source)
);

CREATE INDEX IF NOT EXISTS idx_token_price_sources_chain
  ON token_price_sources (chain_id);

-- 原生币映射：contract_address = 0x000…000 表示 native
INSERT INTO token_price_sources (chain_id, contract_address, source, external_id) VALUES
  (1, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (137, '0x0000000000000000000000000000000000000000', 'coingecko', 'matic-network'),
  (42161, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (10, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (8453, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum')
ON CONFLICT DO NOTHING;
