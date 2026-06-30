import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { Env } from '../config/env.js';
import { logger } from '../infrastructure/logger/logger.js';
import { loadChainProviders } from '../config/env.js';
import { buildProviderRouter } from '../providers/provider-router.js';
import { PortfolioService } from '../services/portfolio-service.js';
import { ActivityService } from '../services/activity-service.js';
import { PriceService } from '../services/price-service.js';
import { BalancesService } from '../services/balances-service.js';
import { NftsService } from '../services/nfts-service.js';
import { createWebhookServices } from '../webhook/index.js';
import { authRouter } from './routes/auth.js';
import { portfolioRouter } from './routes/portfolio.js';
import { activityRouter } from './routes/activity.js';
import { balancesRouter } from './routes/balances.js';
import { nftsRouter } from './routes/nfts.js';
import { webhooksRouter } from './routes/webhooks.js';
import { internalEventsRouter } from './internal/events.js';
import { alchemyNotifyRouter } from './internal/alchemy-notify.js';
import { errorHandler } from './middleware/error-handler.js';

function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function buildAggregatorApp(pool: Pool, redis: Redis, env: Env): express.Application {
  const app = express();
  const allowedOrigins = parseCorsOrigins(env.CORS_ORIGINS);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
  }));
  app.use(pinoHttp({ logger }));

  const router = buildProviderRouter(loadChainProviders());
  const webhookServices = createWebhookServices(pool, redis, env);

  // Alchemy Notify 需要 raw body 验签，须在 express.json 之前挂载
  app.use('/internal/v1', alchemyNotifyRouter(env, webhookServices.consumer));

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  const priceService = new PriceService(pool, redis);
  const portfolioService = new PortfolioService(router, priceService);
  const balancesService = new BalancesService(router, priceService);
  const activityService = new ActivityService(router);
  const nftsService = new NftsService(router);

  app.get('/v1/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      await redis.ping();
      const chainHealth = await Promise.all(
        router.listChainIds().map(async (id) => ({
          chainId: id,
          ...(await router.get(id).health()),
        })),
      );
      res.json({ status: 'ok', chains: chainHealth, ts: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.use('/v1/auth', authRouter(pool, redis));
  app.use('/v1', portfolioRouter(portfolioService, redis));
  app.use('/v1', balancesRouter(balancesService, redis));
  app.use('/v1', nftsRouter(nftsService, redis));
  app.use('/v1', activityRouter(activityService, redis));
  app.use('/v1', webhooksRouter(
    webhookServices.subscriptionManager,
    webhookServices.dispatcher,
    pool,
    redis,
  ));
  app.use('/internal/v1', internalEventsRouter(env, webhookServices.consumer));

  app.locals.webhookServices = webhookServices;

  app.use(errorHandler);
  return app;
}
