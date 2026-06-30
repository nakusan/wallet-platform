import type { CanonicalChainEvent } from '@wallet-platform/canonical';
import { logger } from '../infrastructure/logger/logger.js';
import { AddressIndex } from './address-index.js';
import type { WebhookDispatcher } from './dispatcher.js';

function collectWatchAddresses(event: CanonicalChainEvent): string[] {
  const { activity } = event;
  const addresses = new Set<string>();
  addresses.add(activity.participant.toLowerCase());
  addresses.add(activity.from.toLowerCase());
  if (activity.to) addresses.add(activity.to.toLowerCase());
  return [...addresses];
}

export class ChainEventConsumer {
  constructor(
    private readonly addressIndex: AddressIndex,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  async consume(event: CanonicalChainEvent): Promise<void> {
    if (!event?.eventId || !event?.chainId || !event?.activity) {
      logger.warn({ event }, '忽略无效链内事件');
      return;
    }

    const addresses = collectWatchAddresses(event);
    const subscriptionIds = await this.addressIndex.findSubscriptionIds(
      event.chainId,
      addresses,
    );

    if (subscriptionIds.length === 0) {
      logger.debug({ eventId: event.eventId }, '无匹配 Webhook 订阅');
      return;
    }

    await this.dispatcher.dispatchToSubscriptions(event, subscriptionIds);
  }
}
