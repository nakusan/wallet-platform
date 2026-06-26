import { z } from 'zod';
import type { CanonicalActivityItem } from '@wallet-platform/canonical';

export const activityCursorSchema = z.object({
  blockNumber: z.string().regex(/^\d+$/),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export type ActivityCursor = z.infer<typeof activityCursorSchema>;

export function encodeActivityCursor(c: ActivityCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function parseActivityCursor(encoded: string): ActivityCursor {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid cursor encoding');
  }
  return activityCursorSchema.parse(raw);
}

export function rowToActivityItem(
  chainId: number,
  row: Record<string, unknown>,
): CanonicalActivityItem {
  const participant = String(row.participant_address);
  const txHash = String(row.tx_hash);
  return {
    id: `${chainId}:${txHash}:${participant}`,
    chainId,
    type: row.activity_type as CanonicalActivityItem['type'],
    txHash,
    blockNumber: String(row.block_number),
    timestamp: row.block_timestamp
      ? new Date(row.block_timestamp as string).toISOString()
      : '',
    participant,
    from: String(row.tx_from),
    to: row.tx_to ? String(row.tx_to) : null,
    protocol: row.protocol ? String(row.protocol) : null,
    method: row.method_selector
      ? { selector: String(row.method_selector), name: row.method_name ? String(row.method_name) : null }
      : null,
    movements: (row.movements as CanonicalActivityItem['movements']) ?? [],
    status: row.tx_status === 'failed' ? 'failed' : 'success',
    provider: 'indexer',
  };
}
