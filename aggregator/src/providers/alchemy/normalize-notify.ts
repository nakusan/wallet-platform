import type {
  ActivityType,
  CanonicalActivityItem,
  CanonicalChainEvent,
  CanonicalMovement,
} from '@wallet-platform/canonical';

/** Alchemy Notify ADDRESS_ACTIVITY 单条 activity（精简字段）。 */
export interface AlchemyNotifyActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value?: number | null;
  asset?: string | null;
  category: string;
  rawContract?: {
    rawValue?: string | null;
    address?: string | null;
    decimals?: number | null;
  };
  erc721TokenId?: string | null;
  erc1155Metadata?: Array<{ tokenId: string; value: string }> | null;
  log?: {
    blockTimestamp?: string;
  };
}

export interface AlchemyNotifyPayload {
  webhookId: string;
  id: string;
  createdAt: string;
  type: string;
  event: {
    network: string;
    activity: AlchemyNotifyActivity[];
  };
}

const NETWORK_CHAIN_IDS: Record<string, number> = {
  ETH_MAINNET: 1,
  ETH_SEPOLIA: 11155111,
  POLYGON_MAINNET: 137,
  ARB_MAINNET: 42161,
  OPT_MAINNET: 10,
  BASE_MAINNET: 8453,
};

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
  if (blockNum.startsWith('0x')) return BigInt(blockNum).toString();
  return blockNum;
}

function buildMovement(
  activity: AlchemyNotifyActivity,
  participant: string,
): CanonicalMovement {
  const participantLower = participant.toLowerCase();
  const to = activity.toAddress.toLowerCase();
  const direction: 'in' | 'out' = to === participantLower ? 'in' : 'out';
  const category = activity.category;

  if (category === 'external' || category === 'internal') {
    const raw = activity.rawContract?.rawValue ?? '0';
    return {
      assetType: 'native',
      contract: null,
      tokenId: null,
      symbol: activity.asset ?? 'ETH',
      amountRaw: raw.startsWith('0x') ? BigInt(raw).toString() : raw,
      amount: String(activity.value ?? 0),
      direction,
    };
  }

  if (category === 'erc20') {
    const decimals = activity.rawContract?.decimals ?? 18;
    const raw = activity.rawContract?.rawValue ?? '0';
    const amountRaw = raw.startsWith('0x') ? BigInt(raw).toString() : raw;
    return {
      assetType: 'erc20',
      contract: activity.rawContract?.address?.toLowerCase() ?? null,
      tokenId: null,
      symbol: activity.asset ?? null,
      amountRaw,
      amount: String(activity.value ?? 0),
      direction,
    };
  }

  const tokenId = activity.erc721TokenId
    ?? activity.erc1155Metadata?.[0]?.tokenId
    ?? null;
  const assetType = category === 'erc1155' ? 'erc1155' : 'erc721';

  return {
    assetType,
    contract: activity.rawContract?.address?.toLowerCase() ?? null,
    tokenId,
    symbol: activity.asset ?? null,
    amountRaw: '1',
    amount: '1',
    direction,
  };
}

function activityToCanonical(
  activity: AlchemyNotifyActivity,
  chainId: number,
  participant: string,
): CanonicalActivityItem {
  const blockNumber = parseBlockNumber(activity.blockNum);
  const timestamp = activity.log?.blockTimestamp
    ? new Date(activity.log.blockTimestamp).toISOString()
    : new Date().toISOString();

  return {
    id: `${chainId}:${activity.hash}:${participant.toLowerCase()}`,
    chainId,
    type: categoryToActivityType(activity.category),
    txHash: activity.hash,
    blockNumber,
    timestamp,
    participant: participant.toLowerCase(),
    from: activity.fromAddress.toLowerCase(),
    to: activity.toAddress.toLowerCase(),
    protocol: null,
    method: null,
    movements: [buildMovement(activity, participant)],
    status: 'success',
    provider: 'alchemy',
  };
}

export function normalizeAlchemyNotify(
  payload: AlchemyNotifyPayload,
  chainIdOverride?: number,
): CanonicalChainEvent[] {
  const chainId = chainIdOverride
    ?? NETWORK_CHAIN_IDS[payload.event.network]
    ?? null;
  if (chainId === null) {
    throw new Error(`unsupported Alchemy network: ${payload.event.network}`);
  }

  const events: CanonicalChainEvent[] = [];
  const emittedAt = payload.createdAt ?? new Date().toISOString();

  for (const activity of payload.event.activity ?? []) {
    const participants = new Set<string>([
      activity.fromAddress.toLowerCase(),
      activity.toAddress.toLowerCase(),
    ]);

    for (const participant of participants) {
      const canonicalActivity = activityToCanonical(activity, chainId, participant);
      events.push({
        eventId: `${payload.id}:${activity.hash}:${participant}:activity_created`,
        eventType: 'activity_created',
        chainId,
        activity: canonicalActivity,
        emittedAt,
      });
    }
  }

  return events;
}
