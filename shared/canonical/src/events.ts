import type { CanonicalActivityItem } from './activity.js';

export type ChainEventType = 'activity_created' | 'activity_reverted';

export interface CanonicalChainEvent {
  eventId: string;
  eventType: ChainEventType;
  chainId: number;
  activity: CanonicalActivityItem;
  emittedAt: string;
}
