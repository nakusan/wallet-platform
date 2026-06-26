import type Redis from 'ioredis';

export class EnrichQueue {
  constructor(
    private readonly redis: Redis,
    private readonly chainId: number,
  ) {}

  private key(): string {
    return `tx:enrich:${this.chainId}`;
  }

  async enqueue(txHashes: string[]): Promise<void> {
    if (txHashes.length === 0) return;
    const normalized = [...new Set(txHashes.map((h) => h.toLowerCase()))];
    await this.redis.sadd(this.key(), ...normalized);
  }

  async dequeueBatch(batchSize: number): Promise<string[]> {
    const pipeline = this.redis.pipeline();
    for (let i = 0; i < batchSize; i++) {
      pipeline.spop(this.key());
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const hashes: string[] = [];
    for (const [err, val] of results) {
      if (!err && val) hashes.push(val as string);
    }
    return hashes;
  }
}
