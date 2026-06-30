import type { Pool } from 'pg';
import type Redis from 'ioredis';
import type { Env } from '../config/env.js';
import { buildProviderRouter } from '../providers/provider-router.js';
import { loadChainProviders } from '../config/env.js';
import { AddressIndex } from './address-index.js';
import { ChainEventConsumer } from './chain-event-consumer.js';
import { WebhookDispatcher } from './dispatcher.js';
import { WebhookRetryWorker } from './retry-worker.js';
import { SubscriptionManager } from './subscription-manager.js';

export interface WebhookServices {
  subscriptionManager: SubscriptionManager;
  dispatcher: WebhookDispatcher;
  consumer: ChainEventConsumer;
  retryWorker: WebhookRetryWorker;
}

export function createWebhookServices(
  pool: Pool,
  redis: Redis,
  env: Env,
): WebhookServices {
  const router = buildProviderRouter(loadChainProviders());
  const addressIndex = new AddressIndex(redis);
  const subscriptionManager = new SubscriptionManager(pool, addressIndex, router);
  const dispatcher = new WebhookDispatcher(pool, subscriptionManager, env);
  const consumer = new ChainEventConsumer(addressIndex, dispatcher);
  const retryWorker = new WebhookRetryWorker(dispatcher, env);

  return { subscriptionManager, dispatcher, consumer, retryWorker };
}
