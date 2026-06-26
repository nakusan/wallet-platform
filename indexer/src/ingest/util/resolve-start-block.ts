import { logger } from '../../infrastructure/logger/logger.js';
import type { MonitoredContract } from '../domain/types.js';

export interface IndexWindowStartParams {
  startBlock: bigint | null;
  safeLatest: bigint;
  lookbackBlocks: bigint;
}

export function resolveIndexWindowStart(params: IndexWindowStartParams): bigint {
  const { startBlock, safeLatest, lookbackBlocks } = params;
  const lookbackFloor = safeLatest > lookbackBlocks ? safeLatest - lookbackBlocks : 0n;
  let start = startBlock ?? lookbackFloor;
  if (start < lookbackFloor) start = lookbackFloor;
  return start;
}

export interface ResolveStartBlockParams {
  contract: MonitoredContract;
  checkpoint: bigint | null;
  safeLatest: bigint;
  lookbackBlocks: bigint;
}

export function resolveStartBlock(params: ResolveStartBlockParams): bigint {
  const { contract, checkpoint, safeLatest, lookbackBlocks } = params;

  if (checkpoint != null) {
    const start = checkpoint + 1n;
    logger.info(
      {
        flow: 'indexer.contract',
        symbol: contract.symbol,
        checkpoint: checkpoint.toString(),
        resolvedStartBlock: start.toString(),
        safeLatest: safeLatest.toString(),
      },
      '起始块解析完成（从 checkpoint 续扫）',
    );
    return start;
  }

  const lookbackFloor = safeLatest > lookbackBlocks ? safeLatest - lookbackBlocks : 0n;
  const start = resolveIndexWindowStart({
    startBlock: contract.startBlock,
    safeLatest,
    lookbackBlocks,
  });
  const configured = contract.startBlock ?? lookbackFloor;

  if (start !== configured) {
    logger.warn(
      {
        flow: 'indexer.contract',
        symbol: contract.symbol,
        configuredStartBlock: contract.startBlock?.toString() ?? null,
        resolvedStartBlock: start.toString(),
        lookbackFloor: lookbackFloor.toString(),
      },
      'start_block 已钳制到回看窗口下界',
    );
  } else {
    logger.info(
      {
        flow: 'indexer.contract',
        symbol: contract.symbol,
        checkpoint: null,
        resolvedStartBlock: start.toString(),
        safeLatest: safeLatest.toString(),
      },
      '起始块解析完成',
    );
  }

  return start;
}
