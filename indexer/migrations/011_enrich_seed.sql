-- Enrich 分类种子：常见 method selector + 主网 DEX 合约标签。
-- 其他链可按需追加 INSERT；ON CONFLICT 保证幂等。

INSERT INTO method_signatures (selector, method_name, abi_fragment) VALUES
  ('0xa9059cbb', 'transfer(address,uint256)', '{"type":"function","name":"transfer"}'),
  ('0x095ea7b3', 'approve(address,uint256)', '{"type":"function","name":"approve"}'),
  ('0x23b872dd', 'transferFrom(address,address,uint256)', '{"type":"function","name":"transferFrom"}'),
  ('0x38ed1739', 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', '{"type":"function","name":"swapExactTokensForTokens"}'),
  ('0x8803dbee', 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)', '{"type":"function","name":"swapTokensForExactTokens"}'),
  ('0x414bf389', 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))', '{"type":"function","name":"exactInputSingle"}'),
  ('0xc04b8d70', 'exactInput((bytes,address,uint256,uint256,uint256))', '{"type":"function","name":"exactInput"}'),
  ('0xac9650d8', 'multicall(bytes[])', '{"type":"function","name":"multicall"}'),
  ('0x5c11d795', 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', '{"type":"function","name":"swapExactTokensForTokensSupportingFeeOnTransferTokens"}')
ON CONFLICT (selector) DO NOTHING;

-- Ethereum mainnet (chain_id=1) 常见 DEX router，供 dex_swap 协议识别。
INSERT INTO known_contracts (chain_id, address, protocol, abi_key) VALUES
  (1, '0x7a250d5630b4cf539739df2c5dacb4c659f24f8', 'uniswap_v2', 'uniswap_v2_router'),
  (1, '0xe592427a0aece92de3edee1f18e0157c05861564', 'uniswap_v3', 'uniswap_v3_router'),
  (1, '0x68b3465833fb72a70ecdf485e0e4c7b866e8e93', 'uniswap_v3', 'uniswap_v3_router2'),
  (1, '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', 'sushiswap', 'sushiswap_router'),
  (1, '0x1111111254eeb25477b68fb85ed929f73a960582', '1inch', '1inch_router'),
  (1, '0xef1c6e671033cbab4021632788d1d38cc3609593', 'uniswap_v3', 'uniswap_universal_router')
ON CONFLICT (chain_id, address) DO NOTHING;
