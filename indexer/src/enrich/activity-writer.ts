import type { Pool, PoolClient } from 'pg';
import type { CanonicalActivityItem } from '@wallet-platform/canonical';
import type { WriteSemaphore } from '../infrastructure/db/write-semaphore.js';
import type { EventPublisher } from '../events/event-publisher.js';
import { rowToActivityItem } from '../read-api/util/activity-cursor.js';
import type { ClassifiedTx } from './tx-classifier.js';

export interface ActivityRowInput {
  txHash: string;
  classified: ClassifiedTx;
}

export class ActivityWriter {
  constructor(
    private readonly pool: Pool,
    private readonly chainId: number,
    private readonly eventPublisher: EventPublisher,
    private readonly writeSemaphore: WriteSemaphore,
  ) {}

  async upsertActivities(input: ActivityRowInput): Promise<CanonicalActivityItem[]> {
    const { txHash, classified } = input;
    const releaseSem = await this.writeSemaphore.acquire();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const rows = await this.upsertRows(client, txHash, classified);
      await client.query('COMMIT');

      const items = rows.map((row) => rowToActivityItem(this.chainId, row));
      for (const item of items) {
        await this.eventPublisher.publish({
          eventId: `${this.chainId}:${txHash}:${item.participant}:activity_created`,
          eventType: 'activity_created',
          chainId: this.chainId,
          activity: item,
          emittedAt: new Date().toISOString(),
        });
      }
      return items;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
      releaseSem();
    }
  }

  private async upsertRows(
    client: PoolClient,
    txHash: string,
    classified: ClassifiedTx,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];

    for (const participant of classified.participants) {
      const movements = classified.movementsByParticipant.get(participant) ?? [];
      const { rows: upserted } = await client.query<Record<string, unknown>>(
        `INSERT INTO address_activities (
           chain_id, tx_hash, participant_address,
           block_number, block_timestamp,
           tx_from, tx_to, tx_value_raw, tx_status,
           activity_type, protocol, method_selector, method_name,
           movements, status, enriched_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'indexed',NOW())
         ON CONFLICT (chain_id, tx_hash, participant_address)
         DO UPDATE SET
           block_number=EXCLUDED.block_number,
           block_timestamp=EXCLUDED.block_timestamp,
           tx_from=EXCLUDED.tx_from,
           tx_to=EXCLUDED.tx_to,
           tx_value_raw=EXCLUDED.tx_value_raw,
           tx_status=EXCLUDED.tx_status,
           activity_type=EXCLUDED.activity_type,
           protocol=EXCLUDED.protocol,
           method_selector=EXCLUDED.method_selector,
           method_name=EXCLUDED.method_name,
           movements=EXCLUDED.movements,
           status='indexed',
           enriched_at=NOW()
         RETURNING *`,
        [
          this.chainId,
          txHash.toLowerCase(),
          participant,
          classified.blockNumber.toString(),
          classified.blockTimestamp,
          classified.txFrom,
          classified.txTo,
          classified.txValueRaw.toString(),
          classified.txStatus,
          classified.activityType,
          classified.protocol,
          classified.methodSelector,
          classified.methodName,
          JSON.stringify(movements),
        ],
      );
      if (upserted[0]) rows.push(upserted[0]);
    }

    return rows;
  }
}
