import type { Pool } from 'pg';
import type { PublicClient } from 'viem';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.js';
import { ChainStateRepo } from '../../ingest/db/chain-state-repo.js';
import { getFinalizedBlockNumber } from '../../ingest/chain/viem-client.js';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  chainId: number;
  checks: {
    db: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
    rpc: {
      ok: boolean;
      finalizedBlock: string | null;
      latencyMs: number | null;
      error?: string;
    };
    indexer: {
      finalizedBlock: string;
      minIndexedCheckpoint: string;
      /** RPC finalized 与 minIndexedCheckpoint 的块高差（索引滞后）。 */
      lagBlocks: string;
    };
  };
  ts: string;
}

export class HealthService {
  private readonly chainStateRepo: ChainStateRepo;

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly httpClient: PublicClient,
    private readonly chainId: number,
    private readonly env: Env,
  ) {
    this.chainStateRepo = new ChainStateRepo(pool);
  }

  async check(): Promise<HealthCheckResult> {
    const [db, redisCheck, rpc, chainState] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkRpc(),
      this.chainStateRepo.get(this.chainId),
    ]);

    const indexerFinalized = chainState.finalizedBlock.toString();
    const minIndexed = chainState.minIndexedCheckpoint.toString();
    const rpcFinalized = rpc.finalizedBlock ? BigInt(rpc.finalizedBlock) : 0n;
    const lag = rpcFinalized > chainState.minIndexedCheckpoint
      ? (rpcFinalized - chainState.minIndexedCheckpoint).toString()
      : '0';

    const allCoreOk = db.ok && redisCheck.ok && rpc.ok;
    const status = allCoreOk ? 'ok' : db.ok || redisCheck.ok || rpc.ok ? 'degraded' : 'error';

    return {
      status,
      chainId: this.chainId,
      checks: {
        db,
        redis: redisCheck,
        rpc,
        indexer: {
          finalizedBlock: indexerFinalized,
          minIndexedCheckpoint: minIndexed,
          lagBlocks: lag,
        },
      },
      ts: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; error?: string }> {
    try {
      const pong = await this.redis.ping();
      return { ok: pong === 'PONG' };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async checkRpc(): Promise<HealthCheckResult['checks']['rpc']> {
    const start = Date.now();
    try {
      const blockNumber = await getFinalizedBlockNumber(this.httpClient, this.env);
      return {
        ok: true,
        finalizedBlock: blockNumber.toString(),
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        finalizedBlock: null,
        latencyMs: Date.now() - start,
        error: String(err),
      };
    }
  }
}
