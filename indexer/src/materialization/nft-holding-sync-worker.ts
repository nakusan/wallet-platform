import type { Pool, PoolClient } from 'pg';
import type Redis from 'ioredis';
import { ZERO_ADDRESS, MATERIALIZATION_LOCK_CLASS } from '../config/constants.js';
import { CacheKeys } from '../infrastructure/cache/redis-client.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { WriteSemaphore } from '../infrastructure/db/write-semaphore.js';
import { NftSyncStateRepo, type LaggingContract } from './nft-sync-state-repo.js';

const BATCH_BLOCKS = 2000n;
const MAX_CONTRACTS_PER_TICK = 10;

interface NftTransferRow {
  contract_address: string;
  token_id: string;
  token_standard: string;
  from_address: string;
  to_address: string;
  amount: string;
  block_number: string;
}

/** 定时将 nft_transfers 增量物化到 nft_holdings，并在变更后失效 Redis 缓存。 */
export class NftHoldingSyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly syncStateRepo = new NftSyncStateRepo();

  /**
   * @param pool PostgreSQL 连接池，用于查询转账记录并写入持有表
   * @param redis 用于在持有数据变更后删除对应地址的缓存键
   * @param chainId 当前索引的链 ID
   * @param intervalMs 定时同步间隔（毫秒）
   * @param writeSemaphore 写并发信号量，避免与其他写任务同时打满数据库
   */
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly chainId: number,
    private readonly intervalMs: number,
    private readonly writeSemaphore: WriteSemaphore,
  ) {}

  /** 启动定时器并立即执行一次同步。 */
  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    void this.runOnce();
    logger.info({ intervalMs: this.intervalMs }, 'NftHoldingSyncWorker 已启动');
  }

  /** 停止定时器，不再触发后续同步。 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行一轮同步；若上一轮仍在运行则直接跳过，防止重叠执行。
   */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sync();
    } catch (err) {
      logger.error({ err }, 'NftHoldingSyncWorker 同步失败');
    } finally {
      this.running = false;
    }
  }

  /**
   * 拉取落后合约队列，逐合约增量同步转账，最后批量清除受影响地址的 NFT 持有缓存。
   */
  private async sync(): Promise<void> {
    const lagging = await this.loadWorkQueue();
    if (lagging.length === 0) return;

    const affectedAddrs = new Set<string>();
    let syncedCount = 0;

    for (const item of lagging) {
      const result = await this.syncOneContract(item);
      if (!result) continue;
      syncedCount += result.transferCount;
      for (const addr of result.affectedAddrs) affectedAddrs.add(addr);
    }

    if (syncedCount > 0) {
      logger.debug({ count: syncedCount }, 'NFT 持有同步批次完成');
    }

    const keys = [...affectedAddrs].map((a) => CacheKeys.nftHoldings(this.chainId, a));
    if (keys.length > 0) await this.redis.del(...keys);
  }

  /**
   * 从数据库挑选本轮需要同步的落后 NFT 合约（最多 MAX_CONTRACTS_PER_TICK 个）。
   * @returns 每个合约的地址、上次已同步区块及可安全同步的上界区块
   */
  private async loadWorkQueue(): Promise<LaggingContract[]> {
    const client = await this.pool.connect();
    try {
      return await this.syncStateRepo.pickLaggingNft(
        client, this.chainId, MAX_CONTRACTS_PER_TICK,
      );
    } finally {
      client.release();
    }
  }

  /**
   * 在事务内同步单个合约从 lastSynced+1 到 safeUpper 之间的一批转账（每批最多 BATCH_BLOCKS 个区块）。
   * @param contractAddress 待同步的 NFT 合约地址
   * @param lastSynced 该合约持有快照已物化到的最新区块号
   * @param safeUpper 可安全写入的上界区块（不超过已 finalized 的链头）
   * @returns 本批处理的转账数与涉及的 from/to 地址；若无需同步则返回 null
   */
  private async syncOneContract(
    { contractAddress, lastSynced, safeUpper }: LaggingContract,
  ): Promise<{ transferCount: number; affectedAddrs: string[] } | null> {
    const fromBlock = lastSynced + 1n;
    if (fromBlock > safeUpper) return null;

    const toBlock = fromBlock + BATCH_BLOCKS - 1n <= safeUpper
      ? fromBlock + BATCH_BLOCKS - 1n
      : safeUpper;

    const releaseSem = await this.writeSemaphore.acquire();
    const client = await this.pool.connect();
    const affectedAddrs: string[] = [];
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
        MATERIALIZATION_LOCK_CLASS,
        this.chainId,
      ]);

      const { rows } = await client.query<NftTransferRow>(
        `SELECT contract_address, token_id, token_standard,
                from_address, to_address, amount, block_number
         FROM nft_transfers
         WHERE chain_id=$1 AND contract_address=$2 AND status='indexed'
           AND block_number BETWEEN $3 AND $4
         ORDER BY block_number, log_index, batch_index`,
        [this.chainId, contractAddress.toLowerCase(), fromBlock.toString(), toBlock.toString()],
      );

      for (const row of rows) {
        await this.applyTransfer(client, row, toBlock);
        affectedAddrs.push(row.from_address, row.to_address);
      }

      await this.syncStateRepo.setLastSynced(
        client, this.chainId, contractAddress, toBlock,
      );
      await client.query('COMMIT');

      logger.debug(
        { contract: contractAddress, from: fromBlock.toString(), to: toBlock.toString(), count: rows.length },
        'NFT 持有同步完成',
      );
      return { transferCount: rows.length, affectedAddrs };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
      releaseSem();
    }
  }

  /**
   * 将一条 NFT 转账应用到 nft_holdings：ERC721 做所有权转移，ERC1155 增减数量并清理归零记录。
   * @param client 当前事务中的数据库连接
   * @param row 来自 nft_transfers 的单条转账记录
   * @param blockNumber 本批同步推进到的区块号，写入 last_transfer_block
   */
  private async applyTransfer(client: PoolClient, row: NftTransferRow, blockNumber: bigint): Promise<void> {
    const { contract_address, token_id, token_standard, from_address, to_address, amount } = row;
    const amountBn = BigInt(amount);

    if (token_standard === 'ERC721') {
      if (from_address !== ZERO_ADDRESS) {
        await client.query(
          `DELETE FROM nft_holdings
           WHERE chain_id=$1 AND contract_address=$2 AND token_id=$3 AND owner_address=$4`,
          [this.chainId, contract_address, token_id, from_address],
        );
      }
      if (to_address !== ZERO_ADDRESS) {
        await client.query(
          `INSERT INTO nft_holdings
             (chain_id, contract_address, token_id, token_standard,
              owner_address, amount, last_transfer_block, metadata_fetch_status)
           VALUES ($1,$2,$3,'ERC721',$4,1,$5,'pending')
           ON CONFLICT (chain_id, contract_address, token_id, owner_address)
           DO UPDATE SET last_transfer_block=$5, updated_at=NOW(),
             metadata_fetch_status=CASE
               WHEN nft_holdings.metadata_fetch_status='ok' THEN 'ok'
               ELSE 'pending'
             END`,
          [this.chainId, contract_address, token_id, to_address, blockNumber.toString()],
        );
      }
    } else {
      if (from_address !== ZERO_ADDRESS) {
        await client.query(
          `INSERT INTO nft_holdings
             (chain_id, contract_address, token_id, token_standard,
              owner_address, amount, last_transfer_block, metadata_fetch_status)
           VALUES ($1,$2,$3,'ERC1155',$4,-$5,$6,'pending')
           ON CONFLICT (chain_id, contract_address, token_id, owner_address)
           DO UPDATE SET amount=nft_holdings.amount-$5,
                         last_transfer_block=$6, updated_at=NOW()`,
          [
            this.chainId, contract_address, token_id, from_address,
            amountBn.toString(), blockNumber.toString(),
          ],
        );
      }
      if (to_address !== ZERO_ADDRESS) {
        await client.query(
          `INSERT INTO nft_holdings
             (chain_id, contract_address, token_id, token_standard,
              owner_address, amount, last_transfer_block, metadata_fetch_status)
           VALUES ($1,$2,$3,'ERC1155',$4,$5,$6,'pending')
           ON CONFLICT (chain_id, contract_address, token_id, owner_address)
           DO UPDATE SET amount=nft_holdings.amount+$5,
                         last_transfer_block=$6, updated_at=NOW(),
             metadata_fetch_status=CASE
               WHEN nft_holdings.metadata_fetch_status='ok' THEN 'ok'
               ELSE 'pending'
             END`,
          [this.chainId, contract_address, token_id, to_address, amountBn.toString(), blockNumber.toString()],
        );
      }
      if (from_address !== ZERO_ADDRESS) {
        await client.query(
          `DELETE FROM nft_holdings
           WHERE chain_id=$1 AND contract_address=$2
             AND token_id=$3 AND owner_address=$4 AND amount<=0`,
          [this.chainId, contract_address, token_id, from_address],
        );
      }
    }
  }
}
