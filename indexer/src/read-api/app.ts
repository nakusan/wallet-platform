import express from 'express';
import type { Pool } from 'pg';
import type { PublicClient } from 'viem';
import type Redis from 'ioredis';
import type { Env } from '../config/env.js';
import { CacheService, CacheKeys } from '../infrastructure/cache/redis-client.js';
import { ContractRepo } from '../ingest/db/contract-repo.js';
import { ChainStateRepo } from '../ingest/db/chain-state-repo.js';
import { BalanceQueryService } from './services/balance-query-service.js';
import { ActivityQueryService } from './services/activity-query-service.js';
import { HealthService } from './services/health-service.js';
import { createMetricsHandler } from './routes/metrics.js';
import { internalAuthMiddleware } from './middleware/internal-auth.js';
import { logger } from '../infrastructure/logger/logger.js';

const addrSchema = /^0x[0-9a-fA-F]{40}$/;

export function buildInternalApp(
  pool: Pool,
  redis: Redis,
  httpClient: PublicClient,
  env: Env,
): express.Application {
  const app = express();
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  const auth = internalAuthMiddleware(env);
  const cache = new CacheService(redis);
  const contractRepo = new ContractRepo(pool);
  const chainStateRepo = new ChainStateRepo(pool);
  const balanceQuery = new BalanceQueryService(pool, httpClient, cache, contractRepo, env.CHAIN_ID);
  const activityQuery = new ActivityQueryService(pool, env.CHAIN_ID);
  const healthService = new HealthService(pool, redis, httpClient, env.CHAIN_ID, env);

  app.get('/internal/v1/health', auth, async (_req, res) => {
    try {
      const result = await healthService.check();
      const httpStatus = result.status === 'error' ? 503 : 200;
      res.status(httpStatus).json(result);
    } catch (err) {
      logger.warn({ err }, 'health check failed');
      res.status(503).json({ status: 'error', chainId: env.CHAIN_ID, ts: new Date().toISOString() });
    }
  });

  app.get('/internal/v1/chain/status', auth, async (_req, res) => {
    const state = await chainStateRepo.get(env.CHAIN_ID);
    const contracts = await contractRepo.findActive(env.CHAIN_ID, 'ERC20');
    const nft721 = await contractRepo.findActive(env.CHAIN_ID, 'ERC721');
    const nft1155 = await contractRepo.findActive(env.CHAIN_ID, 'ERC1155');
    res.json({
      chainId: env.CHAIN_ID,
      finalizedBlock: state?.finalizedBlock?.toString() ?? '0',
      minIndexedCheckpoint: state?.minIndexedCheckpoint?.toString() ?? '0',
      monitoredContracts: {
        erc20: contracts.length,
        nft: nft721.length + nft1155.length,
      },
    });
  });

  app.get('/internal/v1/address/:addr/balances', auth, async (req, res, next) => {
    try {
      const addr = String(req.params.addr);
      if (!addrSchema.test(addr)) {
        res.status(400).json({ error: 'invalid_address' });
        return;
      }
      const cacheKey = CacheKeys.tokenBalances(env.CHAIN_ID, addr);
      const result = await cache.getOrSet(cacheKey, 30, () => balanceQuery.getBalances(addr));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/internal/v1/address/:addr/nfts', auth, async (req, res, next) => {
    try {
      const addr = String(req.params.addr);
      if (!addrSchema.test(addr)) {
        res.status(400).json({ error: 'invalid_address' });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
      const result = await balanceQuery.getNftPage(addr, { limit, cursor });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/internal/v1/address/:addr/activity', auth, async (req, res, next) => {
    try {
      const addr = String(req.params.addr);
      if (!addrSchema.test(addr)) {
        res.status(400).json({ error: 'invalid_address' });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
      const types = req.query.types
        ? String(req.query.types).split(',').filter(Boolean)
        : undefined;
      const result = await activityQuery.getActivity(addr, { limit, cursor, types });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/internal/v1/watch-addresses/sync', auth, async (req, res, next) => {
    try {
      const addresses: string[] = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
      for (const a of addresses) {
        if (!addrSchema.test(a)) continue;
        await pool.query(
          `INSERT INTO watch_addresses (chain_id, address) VALUES ($1, lower($2))
           ON CONFLICT (chain_id, address) DO UPDATE SET synced_at=NOW()`,
          [env.CHAIN_ID, a],
        );
      }
      res.json({ synced: addresses.length });
    } catch (err) {
      next(err);
    }
  });

  // Prometheus 文本格式；内网鉴权与 internal API 一致。
  app.get('/metrics', auth, createMetricsHandler({
    pool,
    redis,
    httpClient,
    env,
    chainId: env.CHAIN_ID,
    enrichQueueKey: `tx:enrich:${env.CHAIN_ID}`,
  }));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'internal api error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
