import { z } from 'zod';

/** keyset 分页游标：与 ORDER BY updated_at DESC, contract_address DESC, token_id DESC 对齐。 */
export const nftCursorSchema = z.object({
  updatedAt: z.string().datetime(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenId: z.string().regex(/^\d+$/),
});

export type NftCursor = z.infer<typeof nftCursorSchema>;

export function encodeNftCursor(c: NftCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function parseNftCursor(encoded: string): NftCursor {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid cursor encoding');
  }
  return nftCursorSchema.parse(raw);
}
