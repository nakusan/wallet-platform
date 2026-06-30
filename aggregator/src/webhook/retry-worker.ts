import type { Env } from '../config/env.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { WebhookDispatcher } from './dispatcher.js';

export class WebhookRetryWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly env: Env,
  ) {}

  start(): void {
    const intervalMs = this.env.WEBHOOK_RETRY_INTERVAL_MS ?? 30_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    logger.info({ intervalMs }, 'Webhook RetryWorker 已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.dispatcher.retryPending();
      if (count > 0) {
        logger.info({ count }, 'Webhook 重试批次完成');
      }
    } catch (err) {
      logger.error({ err }, 'Webhook RetryWorker 异常');
    } finally {
      this.running = false;
    }
  }
}
