import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { CanonicalBalances, PricedBalances } from '@wallet-platform/canonical';
import { CacheService } from '../infrastructure/cache/redis-client.js';
import { loadEnv } from '../config/env.js';
import { getChainCoinGeckoMeta } from './chain-coingecko.js';
import { logger } from '../infrastructure/logger/logger.js';

const NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000';

export class PriceService {
  private readonly cache: CacheService;
  private readonly ttl: number;

  constructor(
    private readonly pool: Pool,
    redis: Redis,
  ) {
    this.cache = new CacheService(redis);
    this.ttl = loadEnv().PRICE_CACHE_TTL_SECONDS;
  }

  async priceBalances(balances: CanonicalBalances): Promise<PricedBalances> {
    const { chainId } = balances;
    const meta = getChainCoinGeckoMeta(chainId);

    const nativePrice = meta
      ? await this.getUsdPrice(chainId, NATIVE_SENTINEL, meta.nativeCoinId)
      : null;
    const nativeValueUsd = multiplyUsd(balances.native.balance, nativePrice);

    const tokenPrices = await Promise.all(
      balances.tokens.map(async (token) => {
        const price = await this.getTokenUsdPrice(chainId, token.contractAddress);
        return {
          ...token,
          valueUsd: multiplyUsd(token.balance, price),
        };
      }),
    );

    return {
      ...balances,
      native: {
        ...balances.native,
        valueUsd: nativeValueUsd,
      },
      tokens: tokenPrices,
    };
  }

  async sumChainTotalUsd(balances: PricedBalances): Promise<string | null> {
    const parts: number[] = [];
    if (balances.native.valueUsd != null) {
      const n = Number(balances.native.valueUsd);
      if (!Number.isNaN(n)) parts.push(n);
    }
    for (const t of balances.tokens) {
      if (t.valueUsd != null) {
        const n = Number(t.valueUsd);
        if (!Number.isNaN(n)) parts.push(n);
      }
    }
    if (parts.length === 0) return null;
    const hasMissing = balances.native.valueUsd == null
      || balances.tokens.some((t) => t.valueUsd == null);
    if (hasMissing && parts.length < 1 + balances.tokens.length) {
      // 部分价格缺失：仍返回已知部分之和（与设计「部分加总」一致）
    }
    return parts.reduce((a, b) => a + b, 0).toFixed(6);
  }

  private async getTokenUsdPrice(chainId: number, contractAddress: string): Promise<number | null> {
    const addr = contractAddress.toLowerCase();
    const externalId = await this.lookupExternalId(chainId, addr);
    if (externalId) {
      return this.getUsdPrice(chainId, addr, externalId);
    }

    const meta = getChainCoinGeckoMeta(chainId);
    if (!meta) return null;
    return this.fetchContractPrice(meta.platformId, addr);
  }

  private async lookupExternalId(chainId: number, contractAddress: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ external_id: string }>(
      `SELECT external_id FROM token_price_sources
       WHERE chain_id=$1 AND contract_address=$2 AND source='coingecko'`,
      [chainId, contractAddress],
    );
    return rows[0]?.external_id ?? null;
  }

  private async getUsdPrice(
    chainId: number,
    contractAddress: string,
    externalId: string,
  ): Promise<number | null> {
    const cacheKey = `agg:price:${chainId}:${contractAddress.toLowerCase()}`;
    return this.cache.getOrSet(cacheKey, this.ttl, async () => {
      const price = await this.fetchCoinPrice(externalId);
      return price;
    });
  }

  private async fetchContractPrice(platformId: string, contractAddress: string): Promise<number | null> {
    const cacheKey = `agg:price:platform:${platformId}:${contractAddress}`;
    return this.cache.getOrSet(cacheKey, this.ttl, async () => {
      const env = loadEnv();
      const url = new URL(`https://api.coingecko.com/api/v3/simple/token_price/${platformId}`);
      url.searchParams.set('contract_addresses', contractAddress);
      url.searchParams.set('vs_currencies', 'usd');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (env.COINGECKO_API_KEY) {
        headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
      }
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          logger.warn({ status: res.status, platformId, contractAddress }, 'CoinGecko token_price failed');
          return null;
        }
        const body = await res.json() as Record<string, { usd?: number }>;
        const entry = body[contractAddress.toLowerCase()] ?? body[contractAddress];
        return entry?.usd ?? null;
      } catch (err) {
        logger.warn({ err, platformId, contractAddress }, 'CoinGecko token_price error');
        return null;
      }
    });
  }

  private async fetchCoinPrice(coinId: string): Promise<number | null> {
    const env = loadEnv();
    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', coinId);
    url.searchParams.set('vs_currencies', 'usd');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.COINGECKO_API_KEY) {
      headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
    }
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        logger.warn({ status: res.status, coinId }, 'CoinGecko simple/price failed');
        return null;
      }
      const body = await res.json() as Record<string, { usd?: number }>;
      return body[coinId]?.usd ?? null;
    } catch (err) {
      logger.warn({ err, coinId }, 'CoinGecko simple/price error');
      return null;
    }
  }
}

function multiplyUsd(balance: string, priceUsd: number | null): string | null {
  if (priceUsd == null) return null;
  const amount = Number(balance);
  if (Number.isNaN(amount)) return null;
  return (amount * priceUsd).toFixed(6);
}
