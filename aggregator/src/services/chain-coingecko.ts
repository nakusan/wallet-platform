/** CoinGecko platform id + native coin id，按 chainId 映射。 */
export interface ChainCoinGeckoMeta {
  platformId: string;
  nativeCoinId: string;
  nativeSymbol: string;
}

const CHAIN_COINGECKO: Record<number, ChainCoinGeckoMeta> = {
  1: { platformId: 'ethereum', nativeCoinId: 'ethereum', nativeSymbol: 'ETH' },
  137: { platformId: 'polygon-pos', nativeCoinId: 'matic-network', nativeSymbol: 'MATIC' },
  42161: { platformId: 'arbitrum-one', nativeCoinId: 'ethereum', nativeSymbol: 'ETH' },
  10: { platformId: 'optimistic-ethereum', nativeCoinId: 'ethereum', nativeSymbol: 'ETH' },
  8453: { platformId: 'base', nativeCoinId: 'ethereum', nativeSymbol: 'ETH' },
};

export function getChainCoinGeckoMeta(chainId: number): ChainCoinGeckoMeta | null {
  return CHAIN_COINGECKO[chainId] ?? null;
}
