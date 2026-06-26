import type { Pool } from 'pg';
import type { Hash, PublicClient } from 'viem';
import type Redis from 'ioredis';
import type { Env } from '../config/env.js';
import { getFinalizedBlockNumber } from '../ingest/chain/viem-client.js';
import { withRetry } from '../ingest/util/retry.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { EnrichQueue } from './enrich-queue.js';

/**
 * 可选 Worker：为 watch_addresses 补扫 native transfer（to=地址 且 value>0）。
 * 原型采用窄窗口块扫描 + Redis checkpoint，不依赖 transfer 表触发 enrich。
 */
export class NativeTxWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly pool: Pool,
    private readonly httpClient: PublicClient,
    private readonly redis: Redis,
    private readonly enrichQueue: EnrichQueue,
    private readonly chainId: number,
    private readonly env: Env,
    private readonly intervalMs: number,
    /** 每轮最多扫描的块数，控制 RPC 压力。 */
    private readonly maxBlocksPerTick: number,
  ) {}

  private checkpointKey(): string {
    return `idx:native:watch:${this.chainId}:lastBlock`;
  }

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    void this.runOnce();
    logger.info(
      { flow: 'native-watch', intervalMs: this.intervalMs, maxBlocksPerTick: this.maxBlocksPerTick },
      'NativeTxWatcher 已启动',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ flow: 'native-watch' }, 'NativeTxWatcher 已停止');
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.scan();
    } catch (err) {
      logger.error({ flow: 'native-watch', err }, 'native 块扫描失败');
    } finally {
      this.running = false;
    }
  }

  private async scan(): Promise<void> {
    const watchAddresses = await this.loadWatchAddresses();
    if (watchAddresses.size === 0) return;

    const finalizedBlock = await this.resolveFinalizedBlock();
    if (finalizedBlock <= 0n) return;

    const lastScanned = await this.loadCheckpoint(finalizedBlock);
    if (lastScanned >= finalizedBlock) return;

    const toBlock = lastScanned + BigInt(this.maxBlocksPerTick) < finalizedBlock
      ? lastScanned + BigInt(this.maxBlocksPerTick)
      : finalizedBlock;

    const enqueued = await this.scanBlockRange(watchAddresses, lastScanned + 1n, toBlock);
    await this.redis.set(this.checkpointKey(), toBlock.toString());

    if (enqueued > 0) {
      logger.info(
        { flow: 'native-watch', from: (lastScanned + 1n).toString(), to: toBlock.toString(), enqueued },
        'native transfer 已入 enrich 队列',
      );
    }
  }

  private async loadWatchAddresses(): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ address: string }>(
      `SELECT address FROM watch_addresses WHERE chain_id=$1`,
      [this.chainId],
    );
    return new Set(rows.map((r) => r.address.toLowerCase()));
  }

  /** 使用与索引摄取一致的 finalized 块高解析逻辑。 */
  private async resolveFinalizedBlock(): Promise<bigint> {
    return getFinalizedBlockNumber(this.httpClient, this.env);
  }

  /** 首次运行从 finalized - maxBlocksPerTick 起扫，避免全链回溯。 */
  private async loadCheckpoint(finalizedBlock: bigint): Promise<bigint> {
    const raw = await this.redis.get(this.checkpointKey());
    if (raw) return BigInt(raw);

    const start = finalizedBlock > BigInt(this.maxBlocksPerTick)
      ? finalizedBlock - BigInt(this.maxBlocksPerTick)
      : 0n;
    await this.redis.set(this.checkpointKey(), start.toString());
    return start;
  }

  private async scanBlockRange(
    watchAddresses: Set<string>,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<number> {
    const txHashes: string[] = [];

    for (let n = fromBlock; n <= toBlock; n++) {
      const block = await withRetry(
        () => this.httpClient.getBlock({ blockNumber: n, includeTransactions: true }),
        { label: `native-watch getBlock ${n}` },
      );
      if (!block?.transactions?.length) continue;

      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;
        const to = tx.to?.toLowerCase();
        if (!to || !watchAddresses.has(to) || tx.value <= 0n) continue;
        txHashes.push((tx.hash as Hash).toLowerCase());
      }
    }

    if (txHashes.length === 0) return 0;

    // 跳过已有 activity 的 tx，减少重复 enrich RPC。
    const unseen = await this.filterUnenriched(txHashes);
    if (unseen.length > 0) await this.enrichQueue.enqueue(unseen);
    return unseen.length;
  }

  private async filterUnenriched(txHashes: string[]): Promise<string[]> {
    const { rows } = await this.pool.query<{ tx_hash: string }>(
      `SELECT DISTINCT tx_hash FROM address_activities
       WHERE chain_id=$1 AND tx_hash = ANY($2::text[]) AND status='indexed'`,
      [this.chainId, txHashes],
    );
    const seen = new Set(rows.map((r) => r.tx_hash.toLowerCase()));
    return txHashes.filter((h) => !seen.has(h));
  }
}
