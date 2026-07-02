CREATE TABLE IF NOT EXISTS token_price_sources (
  chain_id          INTEGER NOT NULL,
  contract_address  VARCHAR(42) NOT NULL,
  source            VARCHAR(32) NOT NULL DEFAULT 'coingecko',
  external_id       TEXT NOT NULL,
  PRIMARY KEY (chain_id, contract_address, source)
);

CREATE INDEX IF NOT EXISTS idx_token_price_sources_chain
  ON token_price_sources (chain_id);

-- contract_address = 0x000…000 表示 native；ERC20 填实际合约地址（小写）
-- external_id = CoinGecko coin id，用于 simple/price?ids= 查价
INSERT INTO token_price_sources (chain_id, contract_address, source, external_id) VALUES
  -- native
  (1, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (137, '0x0000000000000000000000000000000000000000', 'coingecko', 'matic-network'),
  (42161, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (10, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),
  (8453, '0x0000000000000000000000000000000000000000', 'coingecko', 'ethereum'),

  -- Ethereum (1)
  (1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'coingecko', 'usd-coin'),       -- USDC
  (1, '0xdac17f958d2ee523a2206206994597c13d831ec7', 'coingecko', 'tether'),         -- USDT
  (1, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'coingecko', 'weth'),           -- WETH
  (1, '0x6b175474e89094c44da98b954eedeac495271d0f', 'coingecko', 'dai'),            -- DAI
  (1, '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 'coingecko', 'wrapped-bitcoin'), -- WBTC
  (1, '0x514910771af9ca656af840dff83e8264eabdc604', 'coingecko', 'chainlink'),     -- LINK
  (1, '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', 'coingecko', 'uniswap'),        -- UNI

  -- Polygon (137)
  (137, '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 'coingecko', 'usd-coin'),     -- USDC (native)
  (137, '0x2791bca1f2de4661ed88a30c99a7a9479ea87ec7', 'coingecko', 'usd-coin'),     -- USDC.e (bridged)
  (137, '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'coingecko', 'tether'),       -- USDT
  (137, '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 'coingecko', 'weth'),         -- WETH
  (137, '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 'coingecko', 'dai'),          -- DAI
  (137, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', 'coingecko', 'wmatic'),       -- WMATIC

  -- Arbitrum (42161)
  (42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'coingecko', 'usd-coin'),   -- USDC (native)
  (42161, '0xff970a61a04b1c14834a43f5de4533eabbd5e0cc', 'coingecko', 'usd-coin'),   -- USDC.e (bridged)
  (42161, '0xfd086bc7cd5c481dcc9a5d2386670d72e4925062', 'coingecko', 'tether'),     -- USDT
  (42161, '0x82af49447d8a07e3bd95bd0d56f55241523fbab1', 'coingecko', 'weth'),       -- WETH
  (42161, '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', 'coingecko', 'dai'),      -- DAI
  (42161, '0x912ce59144191c1204e64559fe8253a0e49e6548', 'coingecko', 'arbitrum'),   -- ARB

  -- Optimism (10)
  (10, '0x0b2c639c533813f4aa9d7837caf62653d097ff85', 'coingecko', 'usd-coin'),      -- USDC (native)
  (10, '0x7f5c764cbc14f9669b88837ca1490cca17c31607', 'coingecko', 'usd-coin'),       -- USDC.e (bridged)
  (10, '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', 'coingecko', 'tether'),        -- USDT
  (10, '0x4200000000000000000000000000000000000006', 'coingecko', 'weth'),          -- WETH
  (10, '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', 'coingecko', 'dai'),         -- DAI
  (10, '0x4200000000000000000000000000000000000042', 'coingecko', 'optimism'),      -- OP

  -- Base (8453)
  (8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'coingecko', 'usd-coin'),    -- USDC (native)
  (8453, '0xd9aaec85b44f6c091584352a059592cd2e94dae9', 'coingecko', 'usd-coin'),    -- USDbC (bridged)
  (8453, '0x4200000000000000000000000000000000000006', 'coingecko', 'weth'),       -- WETH
  (8453, '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', 'coingecko', 'dai')          -- DAI
ON CONFLICT DO NOTHING;
