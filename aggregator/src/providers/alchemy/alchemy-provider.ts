import type {
  CanonicalActivityPage,
  CanonicalBalances,
  CanonicalNftPage,
} from '@wallet-platform/canonical';
import type { ChainProvider, ProviderHealth } from '../chain-provider.js';
import type { AlchemyAssetTransfer, AlchemyTransfersResponse } from './normalize-activity.js';
import { normalizeAlchemyActivity } from './normalize-activity.js';
import { getChainCoinGeckoMeta } from '../../services/chain-coingecko.js';

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message: string; code?: number };
}

interface TokenBalanceResult {
  address: string;
  tokenBalances: Array<{ contractAddress: string; tokenBalance: string }>;
}

interface TokenMetadataResult {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  logo: string | null;
}

interface NftToken {
  contract: { address: string };
  tokenId: string;
  tokenType: string;
  name?: string | null;
  image?: { cachedUrl?: string | null; originalUrl?: string | null };
  tokenUri?: string | null;
}

interface NftsForOwnerResult {
  ownedNfts: NftToken[];
  pageKey?: string;
}

export class AlchemyProvider implements ChainProvider {
  readonly type = 'alchemy' as const;
  private readonly baseUrl: string;

  constructor(
    readonly chainId: number,
    private readonly apiKey: string,
    private readonly network: string,
  ) {
    this.baseUrl = `https://${network}.g.alchemy.com/v2/${apiKey}`;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`alchemy rpc ${method} http ${res.status}`);
    const body = await res.json() as JsonRpcResponse<T>;
    if (body.error) throw new Error(`alchemy rpc ${method}: ${body.error.message}`);
    return body.result as T;
  }

  async getBalances(address: string): Promise<CanonicalBalances> {
    const addr = address.toLowerCase();
    const meta = getChainCoinGeckoMeta(this.chainId);

    const [nativeHex, tokenResult] = await Promise.all([
      this.rpc<string>('eth_getBalance', [addr, 'latest']),
      this.rpc<TokenBalanceResult>('alchemy_getTokenBalances', [addr, { type: 'erc20' }]),
    ]);

    const nativeRaw = BigInt(nativeHex).toString();
    const nativeBalance = formatUnits(BigInt(nativeHex), 18);

    const nonZero = tokenResult.tokenBalances.filter(
      (t) => t.tokenBalance !== '0x0' && t.tokenBalance !== '0x',
    );

    const tokens = await Promise.all(
      nonZero.map(async (t) => {
        const contractAddress = t.contractAddress.toLowerCase();
        let symbol = 'UNKNOWN';
        let decimals = 18;
        try {
          const md = await this.rpc<TokenMetadataResult>('alchemy_getTokenMetadata', [contractAddress]);
          if (md.symbol) symbol = md.symbol;
          if (md.decimals != null) decimals = md.decimals;
        } catch {
          // 元数据失败仍返回余额
        }
        return {
          contractAddress,
          symbol,
          decimals,
          balanceRaw: BigInt(t.tokenBalance).toString(),
          balance: formatUnits(BigInt(t.tokenBalance), decimals),
        };
      }),
    );

    return {
      chainId: this.chainId,
      address: addr,
      native: {
        symbol: meta?.nativeSymbol ?? 'ETH',
        balanceRaw: nativeRaw,
        balance: nativeBalance,
      },
      tokens,
      nfts: [],
      finalizedBlock: null,
      indexedSinceBlock: null,
    };
  }

  async getNfts(
    address: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<CanonicalNftPage> {
    const addr = address.toLowerCase();
    const limit = Math.min(opts.limit ?? 50, 200);
    const params: Record<string, unknown> = {
      owner: addr,
      pageSize: limit,
      withMetadata: true,
    };
    if (opts.cursor) params.pageKey = opts.cursor;

    const result = await this.rpc<NftsForOwnerResult>('alchemy_getNFTsForOwner', [params]);
    const data = result.ownedNfts.map((nft) => ({
      contractAddress: nft.contract.address.toLowerCase(),
      tokenId: nft.tokenId,
      tokenStandard: nft.tokenType === 'ERC1155' ? 'ERC1155' as const : 'ERC721' as const,
      amount: '1',
      name: nft.name ?? null,
      imageUrl: nft.image?.cachedUrl ?? nft.image?.originalUrl ?? null,
      metadataUri: nft.tokenUri ?? null,
    }));

    return {
      chainId: this.chainId,
      address: addr,
      data,
      nextCursor: result.pageKey ?? null,
      hasMore: Boolean(result.pageKey),
    };
  }

  async getActivity(
    address: string,
    opts: { limit?: number; cursor?: string; types?: string[] } = {},
  ): Promise<CanonicalActivityPage> {
    const addr = address.toLowerCase();
    const limit = Math.min(opts.limit ?? 20, 100);
    const fetchCount = Math.min(limit * 3, 1000);

    const baseParams = {
      fromBlock: '0x0',
      category: ['external', 'internal', 'erc20', 'erc721', 'erc1155', 'specialnft'],
      maxCount: fetchCount,
      order: 'desc',
      withMetadata: true,
      ...(opts.cursor ? { pageKey: opts.cursor } : {}),
    };

    const [inbound, outbound] = await Promise.all([
      this.rpc<AlchemyTransfersResponse>('alchemy_getAssetTransfers', [{
        ...baseParams,
        toAddress: addr,
      }]),
      this.rpc<AlchemyTransfersResponse>('alchemy_getAssetTransfers', [{
        ...baseParams,
        fromAddress: addr,
      }]),
    ]);

    const merged = mergeTransfers(inbound.transfers, outbound.transfers);
    const pageKey = inbound.pageKey ?? outbound.pageKey;

    let items = normalizeAlchemyActivity(this.chainId, addr, merged);
    if (opts.types?.length) {
      const allowed = new Set(opts.types);
      items = items.filter((i) => allowed.has(i.type));
    }

    const hasMore = items.length > limit || Boolean(pageKey);
    const data = items.slice(0, limit);

    return {
      chainId: this.chainId,
      address: addr,
      data,
      nextCursor: hasMore ? (pageKey ?? encodeAlchemyCursor(data, merged)) : null,
      hasMore,
    };
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.rpc<string>('eth_blockNumber', []);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const frac = value % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function mergeTransfers(a: AlchemyAssetTransfer[], b: AlchemyAssetTransfer[]): AlchemyAssetTransfer[] {
  const seen = new Set<string>();
  const out: AlchemyAssetTransfer[] = [];
  for (const t of [...a, ...b]) {
    const key = `${t.hash}:${t.category}:${t.from}:${t.to}:${t.tokenId ?? ''}:${t.rawContract?.value ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  out.sort((x, y) => {
    const bx = BigInt(x.blockNum);
    const by = BigInt(y.blockNum);
    return by > bx ? 1 : by < bx ? -1 : 0;
  });
  return out;
}

/** 无 pageKey 时用最后一条 transfer 构造简易 cursor（原型降级）。 */
function encodeAlchemyCursor(
  returned: ReturnType<typeof normalizeAlchemyActivity>,
  transfers: AlchemyAssetTransfer[],
): string {
  const last = returned[returned.length - 1];
  if (!last) return '';
  const lastTransfer = transfers.find((t) => t.hash.toLowerCase() === last.txHash);
  return Buffer.from(JSON.stringify({
    blockNum: lastTransfer?.blockNum ?? last.blockNumber,
    hash: last.txHash,
  })).toString('base64url');
}
