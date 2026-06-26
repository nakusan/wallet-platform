export interface CanonicalNativeBalance {
  symbol: string;
  balanceRaw: string;
  balance: string;
}

export interface CanonicalTokenBalance {
  contractAddress: string;
  symbol: string;
  decimals: number;
  balanceRaw: string;
  balance: string;
}

export interface CanonicalNftHolding {
  contractAddress: string;
  tokenId: string;
  tokenStandard: 'ERC721' | 'ERC1155';
  amount: string;
  name: string | null;
  imageUrl: string | null;
  metadataUri: string | null;
}

export interface CanonicalBalances {
  chainId: number;
  address: string;
  native: CanonicalNativeBalance;
  tokens: CanonicalTokenBalance[];
  nfts: CanonicalNftHolding[];
  finalizedBlock: string | null;
  indexedSinceBlock: string | null;
}
