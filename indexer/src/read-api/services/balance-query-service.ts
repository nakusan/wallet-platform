import type { Pool } from 'pg';
import type { PublicClient } from 'viem';
import { formatEther, formatUnits } from 'viem';
import type { CanonicalBalances, CanonicalNftPage } from '@wallet-platform/canonical';
import type { CacheService } from '../../infrastructure/cache/redis-client.js';
import { CacheKeys } from '../../infrastructure/cache/redis-client.js';
import { withRetry } from '../../ingest/util/retry.js';
import { ContractRepo } from '../../ingest/db/contract-repo.js';
import { ChainStateRepo } from '../../ingest/db/chain-state-repo.js';
import { erc20BalanceAbi } from '../../chain-read/chain-read-abis.js';
import { NftChainVerifier } from '../../chain-read/nft-chain-verifier.js';
import { resolveChain } from '../../ingest/chain/resolve-chain.js';
import { encodeNftCursor, parseNftCursor } from '../util/nft-cursor.js';

export class BalanceQueryService {
  private readonly nftVerifier: NftChainVerifier;
  private readonly chainStateRepo: ChainStateRepo;

  constructor(
    private readonly pool: Pool,
    private readonly httpClient: PublicClient,
    private readonly cache: CacheService,
    private readonly contractRepo: ContractRepo,
    private readonly chainId: number,
  ) {
    this.nftVerifier = new NftChainVerifier(httpClient);
    this.chainStateRepo = new ChainStateRepo(pool);
  }

  async getBalances(address: string): Promise<CanonicalBalances> {
    const addr = address.toLowerCase();
    const nativeSymbol = resolveChain(this.chainId).nativeCurrency.symbol;

    const [native, tokens, nfts, chainState, indexedSinceBlock] = await Promise.all([
      this.getNativeBalance(addr, nativeSymbol),
      this.getTokenBalances(addr),
      this.getNftHoldings(addr),
      this.chainStateRepo.get(this.chainId),
      this.contractRepo.getMinErc20StartBlock(this.chainId),
    ]);

    return {
      chainId: this.chainId,
      address: addr,
      native,
      tokens,
      nfts,
      finalizedBlock: chainState?.finalizedBlock?.toString() ?? null,
      indexedSinceBlock: indexedSinceBlock?.toString() ?? null,
    };
  }

  private async getTokenBalances(address: string) {
    const addr = address as `0x${string}`;
    const tokens = await this.contractRepo.findActive(this.chainId, 'ERC20');
    if (tokens.length === 0) return [];

    const contracts = tokens.map((t) => ({
      address: t.address as `0x${string}`,
      abi: erc20BalanceAbi,
      functionName: 'balanceOf' as const,
      args: [addr] as const,
    }));

    const results = await withRetry(
      () => this.httpClient.multicall({ contracts, blockTag: 'finalized' }),
      { label: `erc20 balanceOf multicall ${addr}` },
    );

    const balances = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const result = results[i];
      if (!result || result.status === 'failure') continue;
      const raw = result.result as bigint;
      if (raw <= 0n) continue;
      const decimals = token.decimals ?? 18;
      balances.push({
        contractAddress: token.address,
        symbol: token.symbol,
        decimals,
        balanceRaw: raw.toString(),
        balance: formatUnits(raw, decimals),
      });
    }
    return balances;
  }

  async getNftPage(
    address: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<CanonicalNftPage> {
    const addr = address.toLowerCase();
    const limit = Math.min(opts.limit ?? 50, 200);
    const cursor = opts.cursor ? parseNftCursor(opts.cursor) : null;

    const { rows } = await this.pool.query(
      `SELECT contract_address, token_id, token_standard, amount, name, image_url, metadata_uri, updated_at
       FROM nft_holdings
       WHERE chain_id=$1 AND owner_address=$2 AND amount>0
         AND ($3::timestamptz IS NULL OR
              (updated_at, contract_address, token_id) < ($3::timestamptz, $4, $5::numeric))
       ORDER BY updated_at DESC, contract_address DESC, token_id DESC
       LIMIT $6`,
      [
        this.chainId,
        addr,
        cursor?.updatedAt ?? null,
        cursor?.contractAddress.toLowerCase() ?? null,
        cursor?.tokenId ?? null,
        limit + 1,
      ],
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const candidates = pageRows.map((r) => ({
      contractAddress: r.contract_address,
      tokenId: String(r.token_id),
      tokenStandard: r.token_standard,
      amount: String(r.amount),
      name: r.name ?? null,
      imageUrl: r.image_url ?? null,
      metadataUri: r.metadata_uri ?? null,
    }));

    // RPC 校验：非 owner / balance=0 的候选不返回（读路径无副作用）。
    const verified = await this.nftVerifier.verifyHoldings(addr, candidates);
    const data = verified.map((n) => ({
      contractAddress: n.contractAddress,
      tokenId: n.tokenId,
      tokenStandard: n.tokenStandard as 'ERC721' | 'ERC1155',
      amount: n.amount,
      name: n.name,
      imageUrl: n.imageUrl,
      metadataUri: n.metadataUri,
    }));

    const last = pageRows[pageRows.length - 1];
    return {
      chainId: this.chainId,
      address: addr,
      data,
      nextCursor: hasMore && last
        ? encodeNftCursor({
          updatedAt: new Date(last.updated_at).toISOString(),
          contractAddress: String(last.contract_address),
          tokenId: String(last.token_id),
        })
        : null,
      hasMore,
    };
  }

  private async getNftHoldings(address: string, limit = 50, offset = 0) {
    const { rows } = await this.pool.query(
      `SELECT contract_address, token_id, token_standard, amount, name, image_url, metadata_uri
       FROM nft_holdings
       WHERE chain_id=$1 AND owner_address=$2 AND amount>0
       ORDER BY updated_at DESC
       LIMIT $3 OFFSET $4`,
      [this.chainId, address, limit, offset],
    );
    const candidates = rows.map((r) => ({
      contractAddress: r.contract_address,
      tokenId: String(r.token_id),
      tokenStandard: r.token_standard,
      amount: String(r.amount),
      name: r.name ?? null,
      imageUrl: r.image_url ?? null,
      metadataUri: r.metadata_uri ?? null,
    }));
    const verified = await this.nftVerifier.verifyHoldings(address, candidates);
    return verified.map((n) => ({
      contractAddress: n.contractAddress,
      tokenId: n.tokenId,
      tokenStandard: n.tokenStandard as 'ERC721' | 'ERC1155',
      amount: n.amount,
      name: n.name,
      imageUrl: n.imageUrl,
      metadataUri: n.metadataUri,
    }));
  }

  private async getNativeBalance(address: string, symbol: string) {
    const key = CacheKeys.nativeBalance(this.chainId, address);
    return this.cache.getOrSet(key, 15, async () => {
      const raw = await withRetry(
        () => this.httpClient.getBalance({ address: address as `0x${string}`, blockTag: 'finalized' }),
        { label: `getBalance ${address}` },
      );
      return {
        symbol,
        balanceRaw: raw.toString(),
        balance: formatEther(raw),
      };
    });
  }
}
