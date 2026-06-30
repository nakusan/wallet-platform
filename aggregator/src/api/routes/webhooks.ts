import { Router } from 'express';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { ChainEventType } from '@wallet-platform/canonical';
import { authMiddleware } from '../middleware/auth.js';
import type { SubscriptionManager } from '../../webhook/subscription-manager.js';
import type { WebhookDispatcher } from '../../webhook/dispatcher.js';

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const eventTypeSchema = z.enum(['activity_created', 'activity_reverted']);

const createSchema = z.object({
  targetUrl: z.string().url(),
  chainIds: z.array(z.number().int().positive()).default([]),
  watchAddresses: z.array(z.string().regex(ADDR_RE)).min(1),
  eventTypes: z.array(eventTypeSchema).min(1),
});

const updateSchema = z.object({
  targetUrl: z.string().url().optional(),
  chainIds: z.array(z.number().int().positive()).optional(),
  watchAddresses: z.array(z.string().regex(ADDR_RE)).min(1).optional(),
  eventTypes: z.array(eventTypeSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});

function toPublicSubscription(sub: {
  id: string;
  targetUrl: string;
  chainIds: number[];
  watchAddresses: string[];
  eventTypes: ChainEventType[];
  isActive: boolean;
  createdAt: Date;
}, includeSecret = false, secret?: string) {
  return {
    id: sub.id,
    targetUrl: sub.targetUrl,
    ...(includeSecret && secret ? { secret } : {}),
    chainIds: sub.chainIds,
    watchAddresses: sub.watchAddresses,
    eventTypes: sub.eventTypes,
    isActive: sub.isActive,
    createdAt: sub.createdAt.toISOString(),
  };
}

export function webhooksRouter(
  subscriptionManager: SubscriptionManager,
  dispatcher: WebhookDispatcher,
  pool: Pool,
  redis: Redis,
): Router {
  const router = Router();

  router.post('/webhooks',
    authMiddleware(['manage:webhook'], redis),
    async (req, res, next) => {
      try {
        const input = createSchema.parse(req.body);
        const sub = await subscriptionManager.create(req.apiKeyId!, input);
        res.status(201).json(toPublicSubscription(sub, true, sub.secret));
      } catch (err) {
        if (err instanceof Error && err.message.includes('HTTPS')) {
          res.status(400).json({ error: 'invalid_target_url', message: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.get('/webhooks',
    authMiddleware(['read:webhook'], redis),
    async (req, res, next) => {
      try {
        const subs = await subscriptionManager.list(req.apiKeyId!);
        res.json({ data: subs.map((s) => toPublicSubscription(s)) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch('/webhooks/:id',
    authMiddleware(['manage:webhook'], redis),
    async (req, res, next) => {
      try {
        const input = updateSchema.parse(req.body);
        const id = String(req.params.id);
        const updated = await subscriptionManager.update(req.apiKeyId!, id, input);
        if (!updated) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.json(toPublicSubscription(updated));
      } catch (err) {
        if (err instanceof Error && err.message.includes('HTTPS')) {
          res.status(400).json({ error: 'invalid_target_url', message: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.delete('/webhooks/:id',
    authMiddleware(['manage:webhook'], redis),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const deleted = await subscriptionManager.delete(req.apiKeyId!, id);
        if (!deleted) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/webhooks/:id/deliveries',
    authMiddleware(['read:webhook'], redis),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const sub = await subscriptionManager.getById(req.apiKeyId!, id);
        if (!sub) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const { rows } = await pool.query(
          `SELECT id, event_id, status, attempt_count, next_retry_at,
                  last_status_code, last_error, created_at, delivered_at
           FROM webhook_deliveries
           WHERE subscription_id=$1
           ORDER BY created_at DESC
           LIMIT $2`,
          [sub.id, limit],
        );
        res.json({
          data: rows.map((r) => ({
            id: r.id,
            eventId: r.event_id,
            status: r.status,
            attemptCount: r.attempt_count,
            nextRetryAt: r.next_retry_at?.toISOString() ?? null,
            lastStatusCode: r.last_status_code,
            lastError: r.last_error,
            createdAt: r.created_at.toISOString(),
            deliveredAt: r.delivered_at?.toISOString() ?? null,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/webhooks/:id/test',
    authMiddleware(['manage:webhook'], redis),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const sub = await subscriptionManager.getById(req.apiKeyId!, id);
        if (!sub) {
          res.status(404).json({ error: 'not_found' });
          return;
        }

        const chainId = sub.chainIds[0] ?? 1;
        const participant = sub.watchAddresses[0];
        const now = new Date().toISOString();
        const testEvent = {
          eventId: `test:${sub.id}:${Date.now()}`,
          eventType: 'activity_created' as const,
          chainId,
          activity: {
            id: `test:${chainId}:0xtest:${participant}`,
            chainId,
            type: 'native_transfer' as const,
            txHash: '0x' + '0'.repeat(64),
            blockNumber: '0',
            timestamp: now,
            participant,
            from: participant,
            to: null,
            protocol: null,
            method: null,
            movements: [],
            status: 'success' as const,
            provider: 'indexer' as const,
          },
          emittedAt: now,
        };

        await dispatcher.deliver(sub, testEvent);
        res.json({ ok: true, eventId: testEvent.eventId });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
