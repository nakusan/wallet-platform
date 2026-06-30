import { Router } from 'express';
import type { CanonicalChainEvent } from '@wallet-platform/canonical';
import type { Env } from '../../config/env.js';
import { logger } from '../../infrastructure/logger/logger.js';
import type { ChainEventConsumer } from '../../webhook/chain-event-consumer.js';

export function internalEventsRouter(
  env: Env,
  consumer: ChainEventConsumer,
): Router {
  const router = Router();

  router.post('/events/chain-activity', async (req, res) => {
    const key = req.header('x-internal-api-key');
    if (env.INTERNAL_API_KEY && key !== env.INTERNAL_API_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const event = req.body as CanonicalChainEvent;
    if (!event?.eventId) {
      res.status(400).json({ error: 'invalid_event' });
      return;
    }

    void consumer.consume(event).catch((err) => {
      logger.error({ err, eventId: event.eventId }, '链内事件消费失败');
    });

    res.status(202).json({ accepted: true });
  });

  return router;
}
