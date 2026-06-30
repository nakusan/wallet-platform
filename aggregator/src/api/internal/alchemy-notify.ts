import { createHmac, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import type { Env } from '../../config/env.js';
import { logger } from '../../infrastructure/logger/logger.js';
import { normalizeAlchemyNotify, type AlchemyNotifyPayload } from '../../providers/alchemy/normalize-notify.js';
import type { ChainEventConsumer } from '../../webhook/chain-event-consumer.js';

function verifyAlchemySignature(
  rawBody: Buffer,
  signature: string | undefined,
  signingKey: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function alchemyNotifyRouter(
  env: Env,
  consumer: ChainEventConsumer,
): Router {
  const router = Router();

  router.post(
    '/events/alchemy-notify',
    express.raw({ type: 'application/json', limit: env.JSON_BODY_LIMIT }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const internalKey = req.header('x-internal-api-key');
        if (env.INTERNAL_API_KEY && internalKey === env.INTERNAL_API_KEY) {
          // 内网转发路径，跳过 Alchemy 签名校验
        } else if (env.ALCHEMY_WEBHOOK_SIGNING_KEY) {
          const signature = req.header('x-alchemy-signature');
          const rawBody = req.body as Buffer;
          if (!verifyAlchemySignature(rawBody, signature, env.ALCHEMY_WEBHOOK_SIGNING_KEY)) {
            res.status(401).json({ error: 'invalid_signature' });
            return;
          }
        } else if (env.NODE_ENV === 'production') {
          res.status(401).json({ error: 'signing_key_not_configured' });
          return;
        }

        const payload = JSON.parse(
          (req.body as Buffer).toString('utf8'),
        ) as AlchemyNotifyPayload;

        const events = normalizeAlchemyNotify(payload);
        for (const event of events) {
          await consumer.consume(event);
        }

        logger.info({ notifyId: payload.id, count: events.length }, '已处理 Alchemy Notify 事件');
        res.status(202).json({ accepted: true, count: events.length });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
