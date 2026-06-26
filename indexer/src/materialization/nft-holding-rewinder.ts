import type { PoolClient } from 'pg';
import { ZERO_ADDRESS } from '../config/constants.js';
import type { MaterializationRewinder } from '../ingest/service/reorg-service.js';
import { logger } from '../infrastructure/logger/logger.js';
import { NftSyncStateRepo } from './nft-sync-state-repo.js';

/** 链重组时回滚并重算 NFT 持有物化快照。 */
export class NftHoldingRewinder implements MaterializationRewinder {
  private readonly syncStateRepo = new NftSyncStateRepo();

  /**
   * 在 reorg 后将 nft_holdings 回退到共同祖先区块的状态，并重算受影响 token 的持有量。
   * @param client 外层 reorg 事务共用的数据库连接
   * @param chainId 发生重组的链 ID
   * @param commonAncestor 新旧链分叉前的共同祖先区块号；该区块及之前的转账视为仍有效
   */
  async rewindForReorg(
    client: PoolClient,
    chainId: number,
    commonAncestor: bigint,
  ): Promise<void> {
    const anchor = commonAncestor.toString();

    const needsRewind = await this.syncStateRepo.hasAnyAbove(client, chainId, commonAncestor);
    if (!needsRewind) return;

    const affectedCte = `
      affected AS (
        SELECT DISTINCT contract_address, token_id FROM nft_transfers
        WHERE chain_id=$1 AND block_number>$2
      )`;

    await client.query(
      `WITH ${affectedCte}
       DELETE FROM nft_holdings h
       USING affected a
       WHERE h.chain_id=$1
         AND h.contract_address=a.contract_address
         AND h.token_id=a.token_id`,
      [chainId, anchor],
    );

    await client.query(
      `WITH ${affectedCte},
       moves AS (
         SELECT contract_address, token_id, token_standard,
                to_address AS owner, amount::NUMERIC AS d
           FROM nft_transfers
           WHERE chain_id=$1 AND status='indexed' AND block_number<=$2 AND to_address<>$3
         UNION ALL
         SELECT contract_address, token_id, token_standard,
                from_address, -amount::NUMERIC
           FROM nft_transfers
           WHERE chain_id=$1 AND status='indexed' AND block_number<=$2 AND from_address<>$3
       ),
       net AS (
         SELECT m.contract_address, m.token_id,
                MIN(m.token_standard) AS token_standard,
                m.owner, SUM(m.d) AS amt
         FROM moves m
         JOIN affected a
           ON a.contract_address=m.contract_address AND a.token_id=m.token_id
         GROUP BY m.contract_address, m.token_id, m.owner
       )
       INSERT INTO nft_holdings
         (chain_id, contract_address, token_id, token_standard,
          owner_address, amount, last_transfer_block)
       SELECT $1, n.contract_address, n.token_id, n.token_standard,
              n.owner, n.amt, $2
       FROM net n
       WHERE n.amt > 0
       ON CONFLICT (chain_id, contract_address, token_id, owner_address) DO UPDATE
         SET amount=EXCLUDED.amount,
             last_transfer_block=EXCLUDED.last_transfer_block,
             updated_at=NOW()`,
      [chainId, anchor, ZERO_ADDRESS],
    );

    await this.syncStateRepo.rewindAllAbove(client, chainId, commonAncestor);

    logger.warn(
      { commonAncestor: anchor },
      'nft 持有快照已随 reorg 回滚并重算受影响 token',
    );
  }
}
