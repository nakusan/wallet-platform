import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { PublicClient } from 'viem';
import { erc721MetadataAbi, erc1155MetadataAbi } from '../chain-read/chain-read-abis.js';
import { CacheKeys } from '../infrastructure/cache/redis-client.js';
import { logger } from '../infrastructure/logger/logger.js';
import { withRetry } from '../ingest/util/retry.js';
import { fetchMetadataFromUri } from './metadata-fetcher.js';
import {
  NftMetadataRepo,
  type MetadataFetchStatus,
  type PendingHoldingRow,
} from './nft-metadata-repo.js';

/** 每 tick 最多处理的持有记录数。 */
const BATCH_SIZE = 50;
/** 连续失败达到此次数后永久标记 failed，不再重试。 */
const MAX_FAILURES = 3;
/** 失败后再次尝试的最小间隔（与 repo claim 条件配合）。 */
const RETRY_BACKOFF_MS = 60_000;
/** fetching 状态超过此时间视为 stale，可被其他 tick 重新认领。 */
const STALE_FETCHING_MS = 5 * 60_000;

/**
 * 异步拉取 NFT metadata，与 NftHoldingSyncWorker 解耦。
 *
 * 流程：DB 认领 pending → multicall tokenURI → HTTP 解析 JSON → 写回 nft_holdings。
 */
export class NftMetadataWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 防止 interval 重叠触发导致同一批并发 claim。 */
  private running = false;
  private readonly metadataRepo = new NftMetadataRepo();

  constructor(
    private readonly pool: Pool,
    private readonly httpClient: PublicClient,
    private readonly redis: Redis,
    private readonly chainId: number,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    void this.runOnce();
    logger.info(
      {
        flow: 'metadata',
        intervalMs: this.intervalMs,
        batchSize: BATCH_SIZE,
        maxFailures: MAX_FAILURES,
      },
      'NftMetadataWorker 已启动：定时拉取 NFT tokenURI 并回填 metadata',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ flow: 'metadata' }, 'NftMetadataWorker 已停止');
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      logger.debug({ flow: 'metadata' }, '上轮批处理未完成，跳过本次 tick');
      return;
    }
    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      logger.error({ flow: 'metadata', err }, 'NftMetadataWorker 批处理失败');
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<void> {
    const rows = await this.metadataRepo.claimPendingHoldings(this.pool, this.chainId, {
      limit: BATCH_SIZE,
      staleFetchingMs: STALE_FETCHING_MS,
      retryBackoffMs: RETRY_BACKOFF_MS,
    });
    if (rows.length === 0) return;

    logger.info(
      { flow: 'metadata', count: rows.length, batchSize: BATCH_SIZE },
      '开始处理 metadata 批次',
    );

    const tokenUris = await this.fetchTokenUris(rows);
    const affectedOwners = new Set<string>();
    let okCount = 0;
    let failedCount = 0;
    let unsupportedCount = 0;

    for (const row of rows) {
      affectedOwners.add(row.owner_address);
      const key = this.holdingKey(row);
      const tokenUri = tokenUris.get(key);

      if (tokenUri === undefined) {
        await this.recordFailure(row, 'tokenURI multicall failed');
        failedCount++;
        continue;
      }
      if (tokenUri === null) {
        await this.markStatus(row, 'unsupported', { metadataUri: null });
        unsupportedCount++;
        logger.debug(
          {
            flow: 'metadata',
            contract: row.contract_address,
            tokenId: row.token_id,
            standard: row.token_standard,
          },
          '合约返回空 tokenURI，标记 unsupported',
        );
        continue;
      }

      try {
        const metadata = await fetchMetadataFromUri(tokenUri, row.token_id);
        await this.markStatus(row, 'ok', {
          metadataUri: metadata.metadataUri,
          name: metadata.name,
          imageUrl: metadata.imageUrl,
        });
        await this.redis.del(this.failKey(row));
        okCount++;
        logger.debug(
          {
            flow: 'metadata',
            contract: row.contract_address,
            tokenId: row.token_id,
            hasName: !!metadata.name,
            hasImage: !!metadata.imageUrl,
          },
          'metadata 拉取成功',
        );
      } catch (err) {
        await this.recordFailure(row, err instanceof Error ? err.message : 'metadata fetch failed');
        failedCount++;
      }
    }

    const cacheKeys = [...affectedOwners].map((a) => CacheKeys.nftHoldings(this.chainId, a));
    if (cacheKeys.length > 0) {
      await this.redis.del(...cacheKeys);
      logger.debug(
        { flow: 'metadata', ownerCount: cacheKeys.length },
        '已失效受影响地址的 NFT 持有缓存',
      );
    }

    logger.info(
      { flow: 'metadata', total: rows.length, ok: okCount, failed: failedCount, unsupported: unsupportedCount },
      'metadata 批次处理完成',
    );
  }

  /** 用于 multicall 结果与 DB 行对齐的复合键。 */
  private holdingKey(row: PendingHoldingRow): string {
    return `${row.contract_address}:${row.token_id}:${row.owner_address}`;
  }

  /** Redis 失败计数 key，连续失败达 MAX_FAILURES 后标记 failed。 */
  private failKey(row: PendingHoldingRow): string {
    return `idx:meta:fail:${this.chainId}:${row.contract_address}:${row.token_id}:${row.owner_address}`;
  }

  /** 批量 multicall tokenURI（ERC721）或 uri（ERC1155），allowFailure 逐条容错。 */
  private async fetchTokenUris(rows: PendingHoldingRow[]): Promise<Map<string, string | null | undefined>> {
    const contracts = rows.map((row) => {
      const tokenId = BigInt(row.token_id);
      const address = row.contract_address as `0x${string}`;
      if (row.token_standard === 'ERC1155') {
        return {
          address,
          abi: erc1155MetadataAbi,
          functionName: 'uri' as const,
          args: [tokenId] as const,
        };
      }
      return {
        address,
        abi: erc721MetadataAbi,
        functionName: 'tokenURI' as const,
        args: [tokenId] as const,
      };
    });

    const results = await withRetry(
      () => this.httpClient.multicall({ contracts, allowFailure: true, blockTag: 'finalized' }),
      { label: 'nft metadata tokenURI multicall', maxAttempts: 3 },
    );

    const out = new Map<string, string | null | undefined>();
    let multicallFailed = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const result = results[i];
      const key = this.holdingKey(row);

      if (!result || result.status === 'failure') {
        out.set(key, undefined);
        multicallFailed++;
        continue;
      }

      const uri = (result.result as string)?.trim();
      out.set(key, uri || null);
    }

    if (multicallFailed > 0) {
      logger.warn(
        { flow: 'metadata', total: rows.length, multicallFailed },
        '部分 tokenURI multicall 失败，对应记录将退避重试',
      );
    }

    return out;
  }

  /** 递增 Redis 失败计数；未达上限则回 pending 等待退避，否则永久 failed。 */
  private async recordFailure(row: PendingHoldingRow, reason: string): Promise<void> {
    const failCount = await this.redis.incr(this.failKey(row));
    if (failCount === 1) await this.redis.expire(this.failKey(row), 7 * 24 * 3600);

    if (failCount >= MAX_FAILURES) {
      await this.markStatus(row, 'failed', { metadataUri: null });
      logger.warn(
        {
          flow: 'metadata',
          contract: row.contract_address,
          tokenId: row.token_id,
          failCount,
          reason,
        },
        'NFT metadata 连续失败，标记 failed',
      );
      return;
    }

    await this.markStatus(row, 'pending', { metadataUri: null });
    logger.debug(
      {
        flow: 'metadata',
        contract: row.contract_address,
        tokenId: row.token_id,
        failCount,
        maxFailures: MAX_FAILURES,
        reason,
      },
      'NFT metadata 拉取失败，稍后重试',
    );
  }

  private async markStatus(
    row: PendingHoldingRow,
    status: MetadataFetchStatus,
    fields: { metadataUri: string | null; name?: string | null; imageUrl?: string | null },
  ): Promise<void> {
    await this.metadataRepo.updateMetadataStatus(this.pool, this.chainId, row, status, fields);
  }
}
