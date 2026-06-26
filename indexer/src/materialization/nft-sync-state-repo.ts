import type { Pool, PoolClient } from 'pg';

export interface LaggingContract {
  contractAddress: string;
  lastSynced: bigint;
  safeUpper: bigint;
}

const INITIAL_SYNCED_EXPR = `GREATEST(COALESCE(mc.start_block, 0) - 1, -1)`;
const CHECKPOINT_FALLBACK_EXPR = INITIAL_SYNCED_EXPR;
const SAFE_UPPER_EXPR = `LEAST(COALESCE(cp.last_indexed_block, ${CHECKPOINT_FALLBACK_EXPR}), cs.finalized_block)`;

export class NftSyncStateRepo {
  async pickLaggingNft(
    client: PoolClient,
    chainId: number,
    limit = 10,
  ): Promise<LaggingContract[]> {
    const { rows } = await client.query(
      `SELECT lower(mc.address) AS contract_address,
              COALESCE(nss.last_synced_block, ${INITIAL_SYNCED_EXPR}) AS last_synced,
              ${SAFE_UPPER_EXPR} AS safe_upper
       FROM monitored_contracts mc
       INNER JOIN indexer_chain_state cs ON cs.chain_id = mc.chain_id
       LEFT JOIN indexer_checkpoints cp
         ON cp.chain_id = mc.chain_id
        AND lower(cp.contract_address) = lower(mc.address)
        AND cp.indexer_type = 'nft'
       LEFT JOIN nft_sync_state nss
         ON nss.chain_id = mc.chain_id
        AND lower(nss.contract_address) = lower(mc.address)
       WHERE mc.chain_id = $1
         AND mc.is_active = true
         AND mc.token_type IN ('ERC721','ERC1155')
         AND COALESCE(nss.last_synced_block, ${INITIAL_SYNCED_EXPR}) < ${SAFE_UPPER_EXPR}
       ORDER BY last_synced ASC
       LIMIT $2`,
      [chainId, limit],
    );
    return rows.map((r) => ({
      contractAddress: r.contract_address as string,
      lastSynced: BigInt(r.last_synced as string),
      safeUpper: BigInt(r.safe_upper as string),
    }));
  }

  async setLastSynced(
    client: PoolClient,
    chainId: number,
    contractAddress: string,
    block: bigint,
  ): Promise<void> {
    await client.query(
      `INSERT INTO nft_sync_state (chain_id, contract_address, last_synced_block)
       VALUES ($1, lower($2), $3)
       ON CONFLICT (chain_id, contract_address) DO UPDATE
         SET last_synced_block = EXCLUDED.last_synced_block,
             updated_at = NOW()`,
      [chainId, contractAddress, block.toString()],
    );
  }

  async rewindAllAbove(
    client: PoolClient,
    chainId: number,
    commonAncestor: bigint,
  ): Promise<void> {
    await client.query(
      `UPDATE nft_sync_state
       SET last_synced_block=$1, updated_at=NOW()
       WHERE chain_id=$2 AND last_synced_block > $1`,
      [commonAncestor.toString(), chainId],
    );
  }

  async hasAnyAbove(
    client: PoolClient,
    chainId: number,
    commonAncestor: bigint,
  ): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM nft_sync_state
       WHERE chain_id=$1 AND last_synced_block > $2
       LIMIT 1`,
      [chainId, commonAncestor.toString()],
    );
    return rows.length > 0;
  }

  async rewindBelowIfNeeded(
    pool: Pool,
    chainId: number,
    contractAddress: string,
    minLastSynced: bigint,
  ): Promise<void> {
    await pool.query(
      `UPDATE nft_sync_state
       SET last_synced_block = $3, updated_at = NOW()
       WHERE chain_id = $1 AND lower(contract_address) = lower($2)
         AND last_synced_block < $3`,
      [chainId, contractAddress, minLastSynced.toString()],
    );
  }
}
