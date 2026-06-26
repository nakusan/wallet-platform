import type {
  ActivityType,
  CanonicalActivityItem,
  CanonicalActivityPage,
  CanonicalMovement,
} from '@wallet-platform/canonical';

/** Alchemy getAssetTransfers 单条 transfer（精简字段）。 */
export interface AlchemyAssetTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract?: {
    value?: string | null;
    address?: string | null;
    decimal?: string | null;
  };
  tokenId?: string | null;
  metadata?: {
    blockTimestamp?: string;
  };
}

export interface AlchemyTransfersResponse {
  transfers: AlchemyAssetTransfer[];
  pageKey?: string;
}

function categoryToActivityType(category: string): ActivityType {
  switch (category) {
    case 'external':
    case 'internal':
      return 'native_transfer';
    case 'erc20':
      return 'erc20_transfer';
    case 'erc721':
    case 'erc1155':
    case 'specialnft':
      return 'nft_transfer';
    default:
      return 'contract_call';
  }
}

function parseBlockNumber(blockNum: string): string {
  if (blockNum.startsWith('0x')) {
    return BigInt(blockNum).toString();
  }
  return blockNum;
}

function formatAmount(raw: string | null | undefined, decimals: number): string {
  if (!raw || raw === '0x0' || raw === '0') return '0';
  try {
    const value = raw.startsWith('0x') ? BigInt(raw) : BigInt(raw);
    if (decimals === 0) return value.toString();
    const divisor = 10n ** BigInt(decimals);
    const whole = value / divisor;
    const frac = value % divisor;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
  } catch {
    return '0';
  }
}

function buildMovement(
  transfer: AlchemyAssetTransfer,
  participant: string,
): CanonicalMovement {
  const participantLower = participant.toLowerCase();
  const to = (transfer.to ?? '').toLowerCase();
  const direction: 'in' | 'out' = to === participantLower ? 'in' : 'out';

  const category = transfer.category;
  if (category === 'external' || category === 'internal') {
    const raw = transfer.rawContract?.value ?? null;
    const amount = transfer.value != null
      ? String(transfer.value)
      : formatAmount(raw, 18);
    return {
      assetType: 'native',
      contract: null,
      tokenId: null,
      symbol: transfer.asset,
      amountRaw: raw ?? amount,
      amount,
      direction,
    };
  }

  if (category === 'erc20') {
    const decimals = transfer.rawContract?.decimal
      ? Number(transfer.rawContract.decimal)
      : 18;
    const raw = transfer.rawContract?.value ?? '0';
    return {
      assetType: 'erc20',
      contract: transfer.rawContract?.address?.toLowerCase() ?? null,
      tokenId: null,
      symbol: transfer.asset,
      amountRaw: raw,
      amount: formatAmount(raw, decimals),
      direction,
    };
  }

  const assetType = category === 'erc1155' ? 'erc1155' : 'erc721';
  const raw = transfer.rawContract?.value ?? '1';
  return {
    assetType,
    contract: transfer.rawContract?.address?.toLowerCase() ?? null,
    tokenId: transfer.tokenId ?? null,
    symbol: transfer.asset,
    amountRaw: raw,
    amount: formatAmount(raw, 0),
    direction,
  };
}

/** 将 Alchemy transfers 按 txHash 分组并映射为 CanonicalActivityItem。 */
export function normalizeAlchemyActivity(
  chainId: number,
  address: string,
  transfers: AlchemyAssetTransfer[],
): CanonicalActivityItem[] {
  const participant = address.toLowerCase();
  const byTx = new Map<string, AlchemyAssetTransfer[]>();

  for (const t of transfers) {
    const hash = t.hash.toLowerCase();
    const list = byTx.get(hash) ?? [];
    list.push(t);
    byTx.set(hash, list);
  }

  const items: CanonicalActivityItem[] = [];

  for (const [txHash, txTransfers] of byTx) {
    const sorted = [...txTransfers].sort((a, b) => {
      const ba = parseBlockNumber(a.blockNum);
      const bb = parseBlockNumber(b.blockNum);
      return bb.localeCompare(ba, undefined, { numeric: true });
    });
    const primary = sorted[0]!;
    const blockNumber = parseBlockNumber(primary.blockNum);
    const timestamp = primary.metadata?.blockTimestamp
      ?? new Date().toISOString();

    const types = new Set(txTransfers.map((t) => categoryToActivityType(t.category)));
    let type: ActivityType = 'contract_call';
    if (types.has('nft_transfer')) type = 'nft_transfer';
    else if (types.has('erc20_transfer')) type = 'erc20_transfer';
    else if (types.has('native_transfer')) type = 'native_transfer';

    const movements = txTransfers.map((t) => buildMovement(t, participant));
    const from = primary.from.toLowerCase();
    const to = primary.to?.toLowerCase() ?? null;

    items.push({
      id: `${chainId}:${txHash}:${participant}`,
      chainId,
      type,
      txHash,
      blockNumber,
      timestamp,
      participant,
      from,
      to,
      protocol: null,
      method: null,
      movements,
      status: 'success',
      provider: 'alchemy',
    });
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items;
}

/** 将 transfers 分页结果转为 CanonicalActivityPage（cursor 为 Alchemy pageKey）。 */
export function toActivityPage(
  chainId: number,
  address: string,
  transfers: AlchemyAssetTransfer[],
  pageKey: string | undefined,
  limit: number,
): CanonicalActivityPage {
  const items = normalizeAlchemyActivity(chainId, address, transfers);
  const hasMore = Boolean(pageKey);
  const data = items.slice(0, limit);

  return {
    chainId,
    address: address.toLowerCase(),
    data,
    nextCursor: pageKey ?? null,
    hasMore,
  };
}
