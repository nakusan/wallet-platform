import type { Pool, PoolClient } from 'pg';
import { logger } from '../infrastructure/logger/logger.js';

/** nft_holdings.metadata_fetch_status 枚举，与 migration CHECK 约束一致。 */
export type MetadataFetchStatus = 'pending' | 'fetching' | 'ok' | 'failed' | 'unsupported';

/** 待拉取 metadata 的持有行（claim 后返回给 Worker 处理）。 */
export interface PendingHoldingRow {
  contract_address: string;
  token_id: string;
  token_standard: string;
  owner_address: string;
}

/** 写回 nft_holdings 的 metadata 字段。 */
export interface MetadataUpdateFields {
  metadataUri: string | null;
  name?: string | null;
  imageUrl?: string | null;
}

/** nft_holdings 表 metadata 相关读写；claim 使用 FOR UPDATE SKIP LOCKED 避免多实例争抢。 */
export class NftMetadataRepo {
  /**
   * 原子认领一批待处理持有记录：
   * - pending 或超时的 fetching（进程崩溃恢复）
   * - 距上次 metadata_fetched_at 超过 retryBackoffMs（失败退避）
   */
  async claimPendingHoldings(
    pool: Pool,
    chainId: number,
    options: { limit: number; staleFetchingMs: number; retryBackoffMs: number },
  ): Promise<PendingHoldingRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<PendingHoldingRow>(
        `SELECT contract_address, token_id, token_standard, owner_address
         FROM nft_holdings
         WHERE chain_id = $1
           AND amount > 0
           AND (
             metadata_fetch_status = 'pending'
             OR (
               metadata_fetch_status = 'fetching'
               AND updated_at < NOW() - ($2 * INTERVAL '1 millisecond')
             )
           )
           AND (
             metadata_fetched_at IS NULL
             OR metadata_fetched_at < NOW() - ($3 * INTERVAL '1 millisecond')
           )
         ORDER BY updated_at ASC
         LIMIT $4
         FOR UPDATE SKIP LOCKED`,
        [chainId, options.staleFetchingMs, options.retryBackoffMs, options.limit],
      );

      if (rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      for (const row of rows) {
        await this.markFetching(client, chainId, row);
      }

      await client.query('COMMIT');
      logger.debug(
        { flow: 'metadata', chainId, count: rows.length },
        '已认领待拉取 metadata 的 NFT 持有记录',
      );
      return rows;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ flow: 'metadata', chainId, err }, '认领 metadata 待处理行失败，事务已回滚');
      throw err;
    } finally {
      client.release();
    }
  }

  /** 更新单条持有的 metadata 字段与 fetch 状态。name/image 仅在传入非 null 时覆盖旧值。 */
  async updateMetadataStatus(
    pool: Pool,
    chainId: number,
    row: PendingHoldingRow,
    status: MetadataFetchStatus,
    fields: MetadataUpdateFields,
  ): Promise<void> {
    await pool.query(
      `UPDATE nft_holdings
       SET metadata_uri = $5,
           name = COALESCE($6, name),
           image_url = COALESCE($7, image_url),
           metadata_fetch_status = $8,
           metadata_fetched_at = NOW(),
           updated_at = NOW()
       WHERE chain_id = $1 AND contract_address = $2 AND token_id = $3 AND owner_address = $4`,
      [
        chainId,
        row.contract_address,
        row.token_id,
        row.owner_address,
        fields.metadataUri,
        fields.name ?? null,
        fields.imageUrl ?? null,
        status,
      ],
    );
  }

  private async markFetching(
    client: PoolClient,
    chainId: number,
    row: PendingHoldingRow,
  ): Promise<void> {
    await client.query(
      `UPDATE nft_holdings
       SET metadata_fetch_status = 'fetching', updated_at = NOW()
       WHERE chain_id = $1 AND contract_address = $2 AND token_id = $3 AND owner_address = $4`,
      [chainId, row.contract_address, row.token_id, row.owner_address],
    );
  }
}
