CREATE TABLE IF NOT EXISTS known_contracts (
  chain_id    INTEGER NOT NULL,
  address     VARCHAR(42) NOT NULL,
  protocol    VARCHAR(32) NOT NULL,
  abi_key     VARCHAR(64) NOT NULL,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS method_signatures (
  selector     VARCHAR(10) PRIMARY KEY,
  method_name  TEXT NOT NULL,
  abi_fragment JSONB
);

CREATE TABLE IF NOT EXISTS watch_addresses (
  chain_id    INTEGER NOT NULL,
  address     VARCHAR(42) NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);
