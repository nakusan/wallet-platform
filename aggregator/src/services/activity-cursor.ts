import type { CanonicalActivityItem } from '@wallet-platform/canonical';
import { z } from 'zod';

/**
 * 多链 Activity 分页状态（序列化后作为 API 的 nextCursor 返回给客户端）。
 *
 * 示例（limit=2，ETH+Polygon 各拉到 2 条，合并 4 条只返回 2 条）：
 * {
 *   v: 1,
 *   perChain: { "1": "eth-page-key", "137": "poly-page-key" },
 *   buffer: [ E2, P2 ]  // 合并排序后第 3、4 条，下次优先返回
 * }
 */
const globalActivityCursorSchema = z.object({
  v: z.literal(1),
  /** chainId → provider 分页 cursor；null 表示该链已拉完 */
  perChain: z.record(z.string(), z.string().nullable()),
  /** 已合并但本页 limit 装不下的活动，下次请求先参与排序 */
  buffer: z.array(z.custom<CanonicalActivityItem>((v) => typeof v === 'object' && v !== null)),
});

export type GlobalActivityCursor = z.infer<typeof globalActivityCursorSchema>;

/** 将 GlobalActivityCursor 编码为 base64url 字符串（API nextCursor）。 */
export function encodeGlobalActivityCursor(cursor: GlobalActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** 解码客户端带回的 cursor；首页无 cursor 时用 emptyGlobalCursor()。 */
export function parseGlobalActivityCursor(encoded: string): GlobalActivityCursor {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid cursor encoding');
  }
  return globalActivityCursorSchema.parse(raw);
}

/** 首页初始状态：各链从 provider 第一页查，无 buffer。 */
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
