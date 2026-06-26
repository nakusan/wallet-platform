import type { CanonicalActivityItem } from '@wallet-platform/canonical';
import { z } from 'zod';

const globalActivityCursorSchema = z.object({
  v: z.literal(1),
  perChain: z.record(z.string(), z.string().nullable()),
  buffer: z.array(z.custom<CanonicalActivityItem>((v) => typeof v === 'object' && v !== null)),
});

export type GlobalActivityCursor = z.infer<typeof globalActivityCursorSchema>;

export function encodeGlobalActivityCursor(cursor: GlobalActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function parseGlobalActivityCursor(encoded: string): GlobalActivityCursor {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid cursor encoding');
  }
  return globalActivityCursorSchema.parse(raw);
}

export function emptyGlobalCursor(): GlobalActivityCursor {
  return { v: 1, perChain: {}, buffer: [] };
}

export function sortActivities(items: CanonicalActivityItem[]): CanonicalActivityItem[] {
  return [...items].sort((a, b) => {
    const ts = b.timestamp.localeCompare(a.timestamp);
    if (ts !== 0) return ts;
    const bn = b.blockNumber.localeCompare(a.blockNumber, undefined, { numeric: true });
    if (bn !== 0) return bn;
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    return b.txHash.localeCompare(a.txHash);
  });
}

export function dedupeActivities(items: CanonicalActivityItem[]): CanonicalActivityItem[] {
  const seen = new Set<string>();
  const out: CanonicalActivityItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
