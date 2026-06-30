import { createHmac } from 'crypto';
import type { Pool } from 'pg';
import type { CanonicalChainEvent } from '@wallet-platform/canonical';
import type { Env } from '../config/env.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { SubscriptionManager } from './subscription-manager.js';
import type { WebhookSubscription } from './types.js';

const MAX_RETRIES_DEFAULT = 5;
const TIMEOUT_MS_DEFAULT = 10_000;

function computeBackoffMs(attempt: number): number {
  const base = 30_000;
  return Math.min(base * 2 ** attempt, 3_600_000);
}

export class WebhookDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly subscriptionManager: SubscriptionManager,
    private readonly env: Env,
  ) {}

  private maxRetries(): number {
    return this.env.WEBHOOK_MAX_RETRIES ?? MAX_RETRIES_DEFAULT;
  }

  private timeoutMs(): number {
    return this.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? TIMEOUT_MS_DEFAULT;
  }

  async dispatchToSubscriptions(
    event: CanonicalChainEvent,
    subscriptionIds: string[],
  ): Promise<void> {
    const subscriptions = await this.subscriptionManager.getByIds(subscriptionIds);
    const matched = subscriptions.filter((sub) => this.matchesSubscription(sub, event));

    await Promise.allSettled(
      matched.map((sub) => this.deliver(sub, event)),
    );
  }

  matchesSubscription(sub: WebhookSubscription, event: CanonicalChainEvent): boolean {
    if (!sub.isActive) return false;
    if (sub.chainIds.length > 0 && !sub.chainIds.includes(event.chainId)) return false;
    if (!sub.eventTypes.includes(event.eventType)) return false;
    return true;
  }

  async deliver(sub: WebhookSubscription, event: CanonicalChainEvent): Promise<void> {
    const existing = await this.pool.query<{
      status: string;
      attempt_count: number;
    }>(
      `SELECT status, attempt_count FROM webhook_deliveries
       WHERE subscription_id=$1 AND event_id=$2`,
      [sub.id, event.eventId],
    );
    if (existing.rows.length > 0 && existing.rows[0].status === 'delivered') {
      return;
    }

    const payload = {
      eventId: event.eventId,
      eventType: event.eventType,
      chainId: event.chainId,
      activity: event.activity,
      emittedAt: event.emittedAt,
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', sub.secret).update(rawBody).digest('hex');

    let statusCode: number | null = null;
    let error: string | null = null;
    let success = false;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs());
      const res = await fetch(sub.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event-Id': event.eventId,
        },
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timer);
      statusCode = res.status;
      success = res.ok;
      if (!success) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const attemptCount = existing.rows.length > 0
      ? Number(existing.rows[0].attempt_count) + 1
      : 1;

    if (success) {
      await this.pool.query(
        `INSERT INTO webhook_deliveries
           (subscription_id, event_id, payload, status, attempt_count, last_status_code, delivered_at)
         VALUES ($1, $2, $3, 'delivered', $4, $5, NOW())
         ON CONFLICT (subscription_id, event_id) DO UPDATE SET
           status='delivered',
           attempt_count=EXCLUDED.attempt_count,
           last_status_code=EXCLUDED.last_status_code,
           last_error=NULL,
           next_retry_at=NULL,
           delivered_at=NOW()`,
        [sub.id, event.eventId, payload, attemptCount, statusCode],
      );
      logger.info({ subscriptionId: sub.id, eventId: event.eventId }, 'Webhook 投递成功');
      return;
    }

    const maxRetries = this.maxRetries();
    const isDead = attemptCount >= maxRetries;
    const nextRetryAt = isDead
      ? null
      : new Date(Date.now() + computeBackoffMs(attemptCount - 1));

    await this.pool.query(
      `INSERT INTO webhook_deliveries
         (subscription_id, event_id, payload, status, attempt_count, next_retry_at,
          last_status_code, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (subscription_id, event_id) DO UPDATE SET
         status=EXCLUDED.status,
         attempt_count=EXCLUDED.attempt_count,
         next_retry_at=EXCLUDED.next_retry_at,
         last_status_code=EXCLUDED.last_status_code,
         last_error=EXCLUDED.last_error`,
      [
        sub.id,
        event.eventId,
        payload,
        isDead ? 'dead' : 'pending',
        attemptCount,
        nextRetryAt,
        statusCode,
        error,
      ],
    );

    logger.warn(
      { subscriptionId: sub.id, eventId: event.eventId, attemptCount, isDead, error },
      'Webhook 投递失败',
    );
  }

  async retryPending(): Promise<number> {
    const { rows } = await this.pool.query<{
      id: string;
      subscription_id: string;
      event_id: string;
      payload: CanonicalChainEvent;
      attempt_count: number;
    }>(
      `SELECT id, subscription_id, event_id, payload, attempt_count
       FROM webhook_deliveries
       WHERE status='pending' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT 50`,
    );

    let retried = 0;
    for (const row of rows) {
      const sub = await this.subscriptionManager.getByIdInternal(row.subscription_id);
      if (!sub || !sub.isActive) {
        await this.pool.query(
          `UPDATE webhook_deliveries SET status='dead', last_error='subscription inactive'
           WHERE id=$1`,
          [row.id],
        );
        continue;
      }

      const event = row.payload as unknown as {
        eventId: string;
        eventType: CanonicalChainEvent['eventType'];
        chainId: number;
        activity: CanonicalChainEvent['activity'];
        emittedAt: string;
      };

      const chainEvent: CanonicalChainEvent = {
        eventId: event.eventId,
        eventType: event.eventType,
        chainId: event.chainId,
        activity: event.activity,
        emittedAt: event.emittedAt,
      };

      await this.deliver(sub, chainEvent);
      retried += 1;
    }
    return retried;
  }
}
