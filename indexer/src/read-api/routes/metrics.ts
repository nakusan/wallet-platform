import type { Pool } from 'pg';
import type { PublicClient } from 'viem';
import type Redis from 'ioredis';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.js';
import { ChainStateRepo } from '../../ingest/db/chain-state-repo.js';
import { getFinalizedBlockNumber } from '../../ingest/chain/viem-client.js';

/** 简单 Prometheus 文本格式导出，无额外依赖。 */
function gauge(name: string, value: number, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  const suffix = labelStr ? `{${labelStr}}` : '';
  return `# TYPE ${name} gauge\n${name}${suffix} ${value}\n`;
}

export interface MetricsDeps {
  pool: Pool;
  redis: Redis;
  httpClient: PublicClient;
  env: Env;
  chainId: number;
  enrichQueueKey: string;
}

export function createMetricsHandler(deps: MetricsDeps) {
  const chainStateRepo = new ChainStateRepo(deps.pool);

  return async (_req: Request, res: Response): Promise<void> => {
    const chainLabel = { chain_id: String(deps.chainId) };
    const lines: string[] = [];

    let dbUp = 0;
    try {
      await deps.pool.query('SELECT 1');
      dbUp = 1;
    } catch { /* dbUp stays 0 */ }
    lines.push(gauge('wallet_indexer_db_up', dbUp, chainLabel));

    let redisUp = 0;
    try {
      const pong = await deps.redis.ping();
      redisUp = pong === 'PONG' ? 1 : 0;
    } catch { /* redisUp stays 0 */ }
    lines.push(gauge('wallet_indexer_redis_up', redisUp, chainLabel));

    let rpcUp = 0;
    let rpcFinalized = 0;
    try {
      const blockNumber = await getFinalizedBlockNumber(deps.httpClient, deps.env);
      rpcUp = 1;
      rpcFinalized = Number(blockNumber);
    } catch { /* rpcUp stays 0 */ }
    lines.push(gauge('wallet_indexer_rpc_up', rpcUp, chainLabel));
    lines.push(gauge('wallet_indexer_rpc_finalized_block', rpcFinalized, chainLabel));

    const chainState = await chainStateRepo.get(deps.chainId);
    const indexerFinalized = Number(chainState.finalizedBlock);
    const minIndexed = Number(chainState.minIndexedCheckpoint);
    const lag = Math.max(0, rpcFinalized - minIndexed);

    lines.push(gauge('wallet_indexer_finalized_block', indexerFinalized, chainLabel));
    lines.push(gauge('wallet_indexer_min_indexed_checkpoint', minIndexed, chainLabel));
    lines.push(gauge('wallet_indexer_index_lag_blocks', lag, chainLabel));

    let enrichQueueSize = 0;
    try {
      enrichQueueSize = await deps.redis.scard(deps.enrichQueueKey);
    } catch { /* stays 0 */ }
    lines.push(gauge('wallet_indexer_enrich_queue_size', enrichQueueSize, chainLabel));

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join(''));
  };
}
