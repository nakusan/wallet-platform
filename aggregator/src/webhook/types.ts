import type { ChainEventType } from '@wallet-platform/canonical';

export type DeliveryStatus = 'pending' | 'delivered' | 'dead';

export interface WebhookSubscriptionRow {
  id: string;
  api_key_id: string;
  target_url: string;
  secret: string;
  chain_ids: number[] | null;
  watch_addresses: string[];
  event_types: string[];
  is_active: boolean;
  created_at: Date;
}

export interface WebhookSubscription {
  id: string;
  apiKeyId: string;
  targetUrl: string;
  secret: string;
  chainIds: number[];
  watchAddresses: string[];
  eventTypes: ChainEventType[];
  isActive: boolean;
  createdAt: Date;
}

export function mapSubscriptionRow(row: WebhookSubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    targetUrl: row.target_url,
    secret: row.secret,
    chainIds: row.chain_ids ?? [],
    watchAddresses: row.watch_addresses.map((a) => a.toLowerCase()),
    eventTypes: row.event_types as ChainEventType[],
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export interface CreateWebhookInput {
  targetUrl: string;
  chainIds: number[];
  watchAddresses: string[];
  eventTypes: ChainEventType[];
}

export interface UpdateWebhookInput {
  targetUrl?: string;
  chainIds?: number[];
  watchAddresses?: string[];
  eventTypes?: ChainEventType[];
  isActive?: boolean;
}
