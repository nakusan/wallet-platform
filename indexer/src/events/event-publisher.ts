import type { CanonicalChainEvent } from '@wallet-platform/canonical';
import type { Env } from '../config/env.js';
import { logger } from '../infrastructure/logger/logger.js';

export class EventPublisher {
  constructor(private readonly env: Env) {}

  async publish(event: CanonicalChainEvent): Promise<void> {
    const url = this.env.AGGREGATOR_EVENT_URL;
    if (!url) {
      logger.debug({ eventId: event.eventId }, 'AGGREGATOR_EVENT_URL 未配置，跳过事件发布');
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': this.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, eventId: event.eventId }, '事件发布失败');
      }
    } catch (err) {
      logger.error({ err, eventId: event.eventId }, '事件发布异常');
    }
  }
}
