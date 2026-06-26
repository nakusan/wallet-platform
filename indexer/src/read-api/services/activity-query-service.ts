import type { Pool } from 'pg';
import type { CanonicalActivityPage } from '@wallet-platform/canonical';
import {
  encodeActivityCursor,
  parseActivityCursor,
  rowToActivityItem,
} from '../util/activity-cursor.js';

export class ActivityQueryService {
  constructor(
    private readonly pool: Pool,
    private readonly chainId: number,
  ) {}

  async getActivity(
    address: string,
    opts: { limit?: number; cursor?: string; types?: string[] } = {},
  ): Promise<CanonicalActivityPage> {
    const addr = address.toLowerCase();
    const limit = Math.min(opts.limit ?? 20, 100);
    const cursor = opts.cursor ? parseActivityCursor(opts.cursor) : null;
    const types = opts.types?.length ? opts.types : null;

    const { rows } = await this.pool.query(
      `SELECT *
       FROM address_activities
       WHERE chain_id=$1 AND participant_address=$2 AND status='indexed'
         AND ($3::text[] IS NULL OR activity_type = ANY($3))
         AND ($4::bigint IS NULL OR
              (block_number, tx_hash) < ($4::bigint, $5))
       ORDER BY block_number DESC, tx_hash DESC
       LIMIT $6`,
      [
        this.chainId,
        addr,
        types,
        cursor?.blockNumber ?? null,
        cursor?.txHash ?? null,
        limit + 1,
      ],
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data[data.length - 1];

    return {
      chainId: this.chainId,
      address: addr,
      data: data.map((r) => rowToActivityItem(this.chainId, r)),
      nextCursor: hasMore && last
        ? encodeActivityCursor({
          blockNumber: String(last.block_number),
          txHash: String(last.tx_hash),
        })
        : null,
      hasMore,
    };
  }
}
