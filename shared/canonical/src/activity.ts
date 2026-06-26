export type ActivityType =
  | 'contract_creation'
  | 'native_transfer'
  | 'erc20_transfer'
  | 'nft_transfer'
  | 'erc20_approve'
  | 'dex_swap'
  | 'contract_call';

export interface CanonicalMovement {
  assetType: 'native' | 'erc20' | 'erc721' | 'erc1155';
  contract: string | null;
  tokenId: string | null;
  symbol: string | null;
  amountRaw: string;
  amount: string;
  direction: 'in' | 'out';
}

export interface CanonicalActivityItem {
  id: string;
  chainId: number;
  type: ActivityType;
  txHash: string;
  blockNumber: string;
  timestamp: string;
  participant: string;
  from: string;
  to: string | null;
  protocol: string | null;
  method: { selector: string; name: string | null } | null;
  movements: CanonicalMovement[];
  status: 'success' | 'failed';
  provider: 'indexer' | 'alchemy';
}

export interface CanonicalActivityPage {
  chainId: number;
  address: string;
  data: CanonicalActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
}
