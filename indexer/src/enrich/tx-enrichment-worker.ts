import type { Pool } from 'pg';
import type { Hash, PublicClient } from 'viem';
import { BlockReader } from '../ingest/chain/block-reader.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { EnrichQueue } from './enrich-queue.js';
import type { EnrichSupportRepo } from './enrich-support-repo.js';
import type { TransferLoader } from './transfer-loader.js';
import { TxClassifier } from './tx-classifier.js';
import type { ActivityWriter } from './activity-writer.js';

const DEFAULT_BATCH_SIZE = 20;
/** 单批内并行 enrich 上限，控制 RPC/DB 压力。 */
const ENRICH_CONCURRENCY = 4;

type EnrichOutcome = 'ok' | 'skipped' | 'requeued';

/** 消费 Redis enrich 队列：拉链上数据 + 已索引 transfer，分类后写入 activity。 */
export class TxEnrichmentWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 防止 interval 重叠触发导致同一批并发 dequeue。 */
  private running = false;
  private readonly blockReader: BlockReader;
  private readonly classifier = new TxClassifier();

  constructor(
    private readonly pool: Pool,
    private readonly httpClient: PublicClient,
    private readonly enrichQueue: EnrichQueue,
    private readonly enrichSupportRepo: EnrichSupportRepo,
    private readonly transferLoader: TransferLoader,
    private readonly activityWriter: ActivityWriter,
    private readonly chainId: number,
    private readonly intervalMs: number,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
  ) {
    this.blockReader = new BlockReader(httpClient);
  }

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    void this.runOnce();
    logger.info(
      { flow: 'enrich', intervalMs: this.intervalMs, batchSize: this.batchSize },
      'TxEnrichmentWorker 已启动：定时从 Redis 队列取交易并写入 activity',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ flow: 'enrich' }, 'TxEnrichmentWorker 已停止');
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      logger.debug({ flow: 'enrich' }, '上轮批处理未完成，跳过本次 tick');
      return;
    }
    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      // 批级失败（如加载 support 数据）：本批已 SPOP 出队，不会 requeue。
      logger.error(
        { flow: 'enrich', err },
        '批处理异常：本批已从队列出队，不会自动 requeue',
      );
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<void> {
    const txHashes = await this.enrichQueue.dequeueBatch(this.batchSize);
    if (txHashes.length === 0) return;

    logger.info(
      { flow: 'enrich', count: txHashes.length, batchSize: this.batchSize },
      '从 enrich 队列取出一批交易',
    );

    // 分类依赖的合约标签与方法签名，整批共享一份，避免每笔重复查库。
    const [knownContracts, methodSignatures] = await Promise.all([
      this.enrichSupportRepo.getKnownContracts(),
      this.enrichSupportRepo.getMethodSignatures(),
    ]);

    const summary = { ok: 0, skipped: 0, requeued: 0 };
    // 限制 RPC/DB 并发，chunk 内并行、chunk 间串行。
    for (let i = 0; i < txHashes.length; i += ENRICH_CONCURRENCY) {
      const chunk = txHashes.slice(i, i + ENRICH_CONCURRENCY);
      const outcomes = await Promise.all(
        chunk.map((txHash) => this.enrichOne(txHash, knownContracts, methodSignatures)),
      );
      for (const outcome of outcomes) summary[outcome]++;
    }

    logger.info({ flow: 'enrich', total: txHashes.length, ...summary }, '本批 enrich 处理完成');
  }

  private async enrichOne(
    txHash: string,
    knownContracts: Map<string, string>,
    methodSignatures: Map<string, string>,
  ): Promise<EnrichOutcome> {
    try {
      const hash = txHash.toLowerCase() as Hash;
      const [tx, receipt, transfers] = await Promise.all([
        this.httpClient.getTransaction({ hash }),
        this.httpClient.getTransactionReceipt({ hash }),
        this.transferLoader.loadByTxHash(hash),
      ]);

      if (!tx || !receipt) {
        // 链上查不到视为无效 hash，丢弃（与 catch 里 requeue 的 transient 错误区分）。
        logger.warn({ flow: 'enrich', txHash: hash }, '链上无交易/回执，跳过且不 requeue');
        return 'skipped';
      }

      const blockTimestamp = await this.resolveBlockTimestamp(
        receipt.blockNumber,
        transfers.tokenTransfers,
        transfers.nftTransfers,
      );

      const classified = this.classifier.classify({
        tx,
        receipt,
        tokenTransfers: transfers.tokenTransfers,
        nftTransfers: transfers.nftTransfers,
        knownContracts,
        methodSignatures,
        blockTimestamp,
      });

      const items = await this.activityWriter.upsertActivities({ txHash: hash, classified });
      logger.debug(
        {
          flow: 'enrich',
          txHash: hash,
          activityType: classified.activityType,
          participants: classified.participants.length,
          items: items.length,
        },
        '单笔 enrich 完成',
      );
      return 'ok';
    } catch (err) {
      // 单笔 transient 失败：requeue 供下轮重试。
      logger.error({ flow: 'enrich', err, txHash }, '单笔 enrich 失败，requeue');
      await this.enrichQueue.enqueue([txHash]);
      return 'requeued';
    }
  }

  /** 优先用 transfer 已物化的时间戳，避免无 transfer 时再打 RPC 取块头。 */
  private async resolveBlockTimestamp(
    blockNumber: bigint,
    tokenTransfers: { blockTimestamp: Date | null }[],
    nftTransfers: { blockTimestamp: Date | null }[],
  ): Promise<Date | null> {
    const fromTransfer = tokenTransfers[0]?.blockTimestamp
      ?? nftTransfers[0]?.blockTimestamp;
    if (fromTransfer) return fromTransfer;

    const header = await this.blockReader.getHeader(blockNumber);
    return header.timestamp;
  }
}
