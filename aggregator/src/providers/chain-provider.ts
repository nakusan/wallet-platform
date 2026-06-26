import type { CanonicalActivityPage, CanonicalBalances, CanonicalNftPage } from '@wallet-platform/canonical';

export interface ProviderHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ChainProvider {
  readonly chainId: number;
  readonly type: 'indexer' | 'alchemy';

  getBalances(address: string): Promise<CanonicalBalances>;
  getNfts(address: string, opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<CanonicalNftPage>;
  getActivity(address: string, opts?: {
    limit?: number;
    cursor?: string;
    types?: string[];
  }): Promise<CanonicalActivityPage>;
  health(): Promise<ProviderHealth>;
}
