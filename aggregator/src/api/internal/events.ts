import { Router } from 'express';
import type { CanonicalChainEvent } from '@wallet-platform/canonical';
import type { Env } from '../../config/env.js';
import { logger } from '../../infrastructure/logger/logger.js';

export function internalEventsRouter(env: Env): Router {
  const router = Router();

  router.post('/events/chain-activity', (req, res) => {
    const key = req.header('x-internal-api-key');
    if (env.INTERNAL_API_KEY && key !== env.INTERNAL_API_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const event = req.body as CanonicalChainEvent;
    logger.info({ eventId: event?.eventId, chainId: event?.chainId }, '收到 indexer 链内事件（webhook 投递待实现）');
    res.status(202).json({ accepted: true });
  });

  return router;
}
