import type Redis from 'ioredis';
import { CacheKeys } from '../infrastructure/cache/redis-client.js';

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export class AddressIndex {
  constructor(private readonly redis: Redis) {}

  private key(chainId: number, address: string): string {
    return CacheKeys.webhookAddress(chainId, normalizeAddress(address));
  }

  async addAddresses(
    subscriptionId: string,
    chainIds: number[],
    watchAddresses: string[],
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const chainId of chainIds) {
      for (const address of watchAddresses) {
        pipeline.sadd(this.key(chainId, address), subscriptionId);
      }
    }
    await pipeline.exec();
  }

  async removeAddresses(
    subscriptionId: string,
    chainIds: number[],
    watchAddresses: string[],
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const chainId of chainIds) {
      for (const address of watchAddresses) {
        pipeline.srem(this.key(chainId, address), subscriptionId);
      }
    }
    await pipeline.exec();
  }

  async findSubscriptionIds(chainId: number, addresses: string[]): Promise<string[]> {
    if (addresses.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const address of addresses) {
      pipeline.smembers(this.key(chainId, normalizeAddress(address)));
    }
    const results = await pipeline.exec();
    const ids = new Set<string>();
    for (const result of results ?? []) {
      if (!result || result[0]) continue;
      const members = result[1] as string[];
      for (const id of members) ids.add(id);
    }
    return [...ids];
  }

  async clearAll(): Promise<void> {
    const pattern = 'wh:addr:*';
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }
}
