import type { CanonicalBalances, CanonicalNativeBalance, CanonicalTokenBalance } from './balances.js';

export interface PricedNativeBalance extends CanonicalNativeBalance {
  valueUsd: string | null;
}

export interface PricedTokenBalance extends CanonicalTokenBalance {
  valueUsd: string | null;
}

export interface PricedBalances extends Omit<CanonicalBalances, 'native' | 'tokens'> {
  native: PricedNativeBalance;
  tokens: PricedTokenBalance[];
}

export interface ChainPortfolioResult {
  chainId: number;
  status: 'ok' | 'error';
  error?: string;
  data?: PricedBalances & { chainTotalUsd?: string | null };
}

export interface PortfolioResponse {
  address: string;
  chains: ChainPortfolioResult[];
  totalValueUsd: string | null;
  partial: boolean;
}
