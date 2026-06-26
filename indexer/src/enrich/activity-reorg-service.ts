import type { PoolClient } from 'pg';
import type { EventPublisher } from '../events/event-publisher.js';
import { rowToActivityItem } from '../read-api/util/activity-cursor.js';

export interface ActivityReorgHandler {
  markReorgedAndPublish(
    client: PoolClient,
    chainId: number,
    afterBlock: bigint,
  ): Promise<void>;
}

export class ActivityReorgService implements ActivityReorgHandler {
  constructor(
    private readonly eventPublisher: EventPublisher,
  ) {}

  async markReorgedAndPublish(
    client: PoolClient,
    chainId: number,
    afterBlock: bigint,
  ): Promise<void> {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE address_activities
       SET status='reorged'
       WHERE chain_id=$1 AND block_number>$2 AND status='indexed'
       RETURNING *`,
      [chainId, afterBlock.toString()],
    );

    for (const row of rows) {
      const activity = rowToActivityItem(chainId, row);
      const txHash = String(row.tx_hash);
      const participant = String(row.participant_address);
      await this.eventPublisher.publish({
        eventId: `${chainId}:${txHash}:${participant}:activity_reverted`,
        eventType: 'activity_reverted',
        chainId,
        activity,
        emittedAt: new Date().toISOString(),
      });
    }
  }
}
