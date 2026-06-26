import type { CanonicalNftHolding } from './balances.js';

/** NFT 分页响应（Indexer /internal/v1/address/:addr/nfts）。 */
export interface CanonicalNftPage {
  chainId: number;
  address: string;
  data: CanonicalNftHolding[];
  nextCursor: string | null;
  hasMore: boolean;
}
