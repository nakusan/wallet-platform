import type { ActivityType, CanonicalMovement } from '@wallet-platform/canonical';
import type { NftTransferRecord, TransferRecord } from '../ingest/domain/types.js';
import type { Transaction, TransactionReceipt } from 'viem';

/** ERC20 Approval(address,address,uint256) */
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

/** Uniswap V2 Swap */
const UNISWAP_V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

/** Uniswap V3 Swap */
const UNISWAP_V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e2fb568699';

const DEX_PROTOCOL_PREFIXES = ['uniswap', 'sushi', 'curve', 'balancer', '1inch', 'pancake'];

const DEX_SWAP_TOPICS = new Set([
  UNISWAP_V2_SWAP_TOPIC,
  UNISWAP_V3_SWAP_TOPIC,
]);

export interface ClassifyInput {
  tx: Transaction;
  receipt: TransactionReceipt;
  tokenTransfers: TransferRecord[];
  nftTransfers: NftTransferRecord[];
  knownContracts: Map<string, string>;
  methodSignatures: Map<string, string>;
  blockTimestamp: Date | null;
}

export interface ClassifiedTx {
  activityType: ActivityType;
  protocol: string | null;
  methodSelector: string | null;
  methodName: string | null;
  txStatus: 'success' | 'failed';
  blockNumber: bigint;
  blockTimestamp: Date | null;
  txFrom: string;
  txTo: string | null;
  txValueRaw: bigint;
  participants: string[];
  movementsByParticipant: Map<string, CanonicalMovement[]>;
}

export class TxClassifier {
  classify(input: ClassifyInput): ClassifiedTx {
    const txFrom = input.tx.from.toLowerCase();
    const txTo = input.tx.to?.toLowerCase() ?? null;
    const txValueRaw = input.tx.value;
    const txStatus = input.receipt.status === 'success' ? 'success' : 'failed';
    const blockNumber = input.receipt.blockNumber;

    const methodSelector = extractMethodSelector(input.tx.input);
    const methodName = methodSelector
      ? input.methodSignatures.get(methodSelector) ?? null
      : null;

    const protocol = resolveProtocol(input.tx, input.knownContracts);
    const activityType = resolveActivityType(input, protocol);

    const participants = collectParticipants(txFrom, txTo, input.tokenTransfers, input.nftTransfers);
    const movementsByParticipant = buildMovementsByParticipant(
      participants,
      txFrom,
      txTo,
      txValueRaw,
      input.tokenTransfers,
      input.nftTransfers,
    );

    return {
      activityType,
      protocol,
      methodSelector,
      methodName,
      txStatus,
      blockNumber,
      blockTimestamp: input.blockTimestamp,
      txFrom,
      txTo,
      txValueRaw,
      participants,
      movementsByParticipant,
    };
  }
}

function extractMethodSelector(input: `0x${string}`): string | null {
  if (!input || input === '0x' || input.length < 10) return null;
  return input.slice(0, 10).toLowerCase();
}

function resolveProtocol(
  tx: Transaction,
  knownContracts: Map<string, string>,
): string | null {
  const target = tx.to?.toLowerCase();
  if (!target) return null;
  return knownContracts.get(target) ?? null;
}

function resolveActivityType(input: ClassifyInput, protocol: string | null): ActivityType {
  if (input.tx.to == null) return 'contract_creation';
  if (isDexSwap(input.receipt, protocol)) return 'dex_swap';
  if (hasApprovalLog(input.receipt) && input.tokenTransfers.length === 0) return 'erc20_approve';
  if (input.nftTransfers.length > 0) return 'nft_transfer';
  if (input.tokenTransfers.length > 0) return 'erc20_transfer';
  if (input.tx.value > 0n) return 'native_transfer';
  return 'contract_call';
}

function isDexSwap(receipt: TransactionReceipt, protocol: string | null): boolean {
  if (!protocol || !isDexProtocol(protocol)) return false;
  return receipt.logs.some((log) => {
    const topic = log.topics[0]?.toLowerCase();
    return topic != null && DEX_SWAP_TOPICS.has(topic);
  });
}

function isDexProtocol(protocol: string): boolean {
  const lower = protocol.toLowerCase();
  return DEX_PROTOCOL_PREFIXES.some((p) => lower.includes(p));
}

function hasApprovalLog(receipt: TransactionReceipt): boolean {
  return receipt.logs.some((log) => log.topics[0]?.toLowerCase() === APPROVAL_TOPIC);
}

function collectParticipants(
  txFrom: string,
  txTo: string | null,
  tokenTransfers: TransferRecord[],
  nftTransfers: NftTransferRecord[],
): string[] {
  const set = new Set<string>([txFrom]);
  if (txTo) set.add(txTo);
  for (const t of tokenTransfers) {
    set.add(t.fromAddress.toLowerCase());
    set.add(t.toAddress.toLowerCase());
  }
  for (const t of nftTransfers) {
    set.add(t.fromAddress.toLowerCase());
    set.add(t.toAddress.toLowerCase());
  }
  return [...set];
}

function buildMovementsByParticipant(
  participants: string[],
  txFrom: string,
  txTo: string | null,
  txValueRaw: bigint,
  tokenTransfers: TransferRecord[],
  nftTransfers: NftTransferRecord[],
): Map<string, CanonicalMovement[]> {
  const map = new Map<string, CanonicalMovement[]>();
  for (const p of participants) map.set(p, []);

  if (txValueRaw > 0n) {
    if (txFrom) appendMovement(map, txFrom, nativeMovement(txValueRaw, 'out'));
    if (txTo) appendMovement(map, txTo, nativeMovement(txValueRaw, 'in'));
  }

  for (const t of tokenTransfers) {
    const from = t.fromAddress.toLowerCase();
    const to = t.toAddress.toLowerCase();
    const movement: CanonicalMovement = {
      assetType: 'erc20',
      contract: t.contractAddress,
      tokenId: null,
      symbol: t.symbol,
      amountRaw: t.amountRaw,
      amount: t.amount,
      direction: 'out',
    };
    appendMovement(map, from, { ...movement, direction: 'out' });
    appendMovement(map, to, { ...movement, direction: 'in' });
  }

  for (const t of nftTransfers) {
    const from = t.fromAddress.toLowerCase();
    const to = t.toAddress.toLowerCase();
    const assetType = t.tokenStandard === 'ERC721' ? 'erc721' : 'erc1155';
    const amountStr = t.amount.toString();
    const movement: CanonicalMovement = {
      assetType,
      contract: t.contractAddress,
      tokenId: t.tokenId.toString(),
      symbol: null,
      amountRaw: amountStr,
      amount: amountStr,
      direction: 'out',
    };
    appendMovement(map, from, { ...movement, direction: 'out' });
    appendMovement(map, to, { ...movement, direction: 'in' });
  }

  return map;
}

function nativeMovement(amountRaw: bigint, direction: 'in' | 'out'): CanonicalMovement {
  const raw = amountRaw.toString();
  return {
    assetType: 'native',
    contract: null,
    tokenId: null,
    symbol: null,
    amountRaw: raw,
    amount: raw,
    direction,
  };
}

function appendMovement(
  map: Map<string, CanonicalMovement[]>,
  participant: string,
  movement: CanonicalMovement,
): void {
  const list = map.get(participant);
  if (list) list.push(movement);
}
