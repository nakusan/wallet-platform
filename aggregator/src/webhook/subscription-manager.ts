import { randomBytes } from 'crypto';
import type { Pool } from 'pg';
import type { ChainProviderConfig } from '../config/env.js';
import { loadChainProviders } from '../config/env.js';
import { logger } from '../infrastructure/logger/logger.js';
import { IndexerProvider } from '../providers/indexer/indexer-provider.js';
import type { ProviderRouter } from '../providers/provider-router.js';
import { AddressIndex } from './address-index.js';
import {
  mapSubscriptionRow,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookSubscription,
  type WebhookSubscriptionRow,
} from './types.js';

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function normalizeAddresses(addresses: string[]): string[] {
  return [...new Set(addresses.map((a) => a.toLowerCase()))];
}

function assertHttpsUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('target_url must use HTTPS');
  }
}

function assertAddresses(addresses: string[]): void {
  if (addresses.length === 0) throw new Error('watch_addresses required');
  for (const addr of addresses) {
    if (!ADDR_RE.test(addr)) throw new Error(`invalid address: ${addr}`);
  }
}

export class SubscriptionManager {
  constructor(
    private readonly pool: Pool,
    private readonly addressIndex: AddressIndex,
    private readonly router: ProviderRouter,
  ) {}

  async rebuildIndex(): Promise<void> {
    await this.addressIndex.clearAll();
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE is_active=true`,
    );
    for (const row of rows) {
      const sub = mapSubscriptionRow(row);
      const chainIds = this.resolveChainIds(sub.chainIds);
      await this.addressIndex.addAddresses(sub.id, chainIds, sub.watchAddresses);
    }
    logger.info({ count: rows.length }, 'AddressIndex 已重建');
  }

  async create(apiKeyId: string, input: CreateWebhookInput): Promise<WebhookSubscription> {
    assertHttpsUrl(input.targetUrl);
    const watchAddresses = normalizeAddresses(input.watchAddresses);
    assertAddresses(watchAddresses);

    const secret = randomBytes(32).toString('hex');
    const chainIds = input.chainIds.length > 0 ? input.chainIds : null;

    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `INSERT INTO webhook_subscriptions
         (api_key_id, target_url, secret, chain_ids, watch_addresses, event_types)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        apiKeyId,
        input.targetUrl,
        secret,
        chainIds,
        watchAddresses,
        input.eventTypes,
      ],
    );

    const sub = mapSubscriptionRow(rows[0]);
    const resolvedChainIds = this.resolveChainIds(sub.chainIds);
    await this.addressIndex.addAddresses(sub.id, resolvedChainIds, sub.watchAddresses);
    await this.syncIndexerWatchAddresses();
    return sub;
  }

  async list(apiKeyId: string): Promise<WebhookSubscription[]> {
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE api_key_id=$1 ORDER BY created_at DESC`,
      [apiKeyId],
    );
    return rows.map(mapSubscriptionRow);
  }

  async getById(apiKeyId: string, id: string): Promise<WebhookSubscription | null> {
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE id=$1 AND api_key_id=$2`,
      [id, apiKeyId],
    );
    return rows.length > 0 ? mapSubscriptionRow(rows[0]) : null;
  }

  async getByIdInternal(id: string): Promise<WebhookSubscription | null> {
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE id=$1`,
      [id],
    );
    return rows.length > 0 ? mapSubscriptionRow(rows[0]) : null;
  }

  async getByIds(ids: string[]): Promise<WebhookSubscription[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE id = ANY($1::uuid[]) AND is_active=true`,
      [ids],
    );
    return rows.map(mapSubscriptionRow);
  }

  async update(
    apiKeyId: string,
    id: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookSubscription | null> {
    const existing = await this.getById(apiKeyId, id);
    if (!existing) return null;

    if (input.targetUrl) assertHttpsUrl(input.targetUrl);
    if (input.watchAddresses) {
      const addrs = normalizeAddresses(input.watchAddresses);
      assertAddresses(addrs);
      input.watchAddresses = addrs;
    }

    const oldChainIds = this.resolveChainIds(existing.chainIds);
    await this.addressIndex.removeAddresses(existing.id, oldChainIds, existing.watchAddresses);

    const targetUrl = input.targetUrl ?? existing.targetUrl;
    const chainIds = input.chainIds !== undefined
      ? (input.chainIds.length > 0 ? input.chainIds : null)
      : (existing.chainIds.length > 0 ? existing.chainIds : null);
    const watchAddresses = input.watchAddresses ?? existing.watchAddresses;
    const eventTypes = input.eventTypes ?? existing.eventTypes;
    const isActive = input.isActive ?? existing.isActive;

    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `UPDATE webhook_subscriptions
       SET target_url=$1, chain_ids=$2, watch_addresses=$3, event_types=$4, is_active=$5
       WHERE id=$6 AND api_key_id=$7
       RETURNING *`,
      [targetUrl, chainIds, watchAddresses, eventTypes, isActive, id, apiKeyId],
    );

    const updated = mapSubscriptionRow(rows[0]);
    if (updated.isActive) {
      const newChainIds = this.resolveChainIds(updated.chainIds);
      await this.addressIndex.addAddresses(updated.id, newChainIds, updated.watchAddresses);
    }
    await this.syncIndexerWatchAddresses();
    return updated;
  }

  async delete(apiKeyId: string, id: string): Promise<boolean> {
    const existing = await this.getById(apiKeyId, id);
    if (!existing) return false;

    const chainIds = this.resolveChainIds(existing.chainIds);
    await this.addressIndex.removeAddresses(existing.id, chainIds, existing.watchAddresses);

    await this.pool.query(
      `DELETE FROM webhook_subscriptions WHERE id=$1 AND api_key_id=$2`,
      [id, apiKeyId],
    );
    await this.syncIndexerWatchAddresses();
    return true;
  }

  async syncIndexerWatchAddresses(): Promise<void> {
    const configs = loadChainProviders();
    const { rows } = await this.pool.query<WebhookSubscriptionRow>(
      `SELECT * FROM webhook_subscriptions WHERE is_active=true`,
    );
    const subscriptions = rows.map(mapSubscriptionRow);

    for (const [chainIdStr, cfg] of Object.entries(configs)) {
      if (cfg.provider !== 'indexer') continue;
      const chainId = Number(chainIdStr);
      const addresses = this.collectAddressesForChain(subscriptions, chainId);
      await this.syncToIndexer(chainId, cfg, addresses);
    }
  }

  private collectAddressesForChain(
    subscriptions: WebhookSubscription[],
    chainId: number,
  ): string[] {
    const set = new Set<string>();
    for (const sub of subscriptions) {
      if (sub.chainIds.length > 0 && !sub.chainIds.includes(chainId)) continue;
      for (const addr of sub.watchAddresses) set.add(addr);
    }
    return [...set];
  }

  private async syncToIndexer(
    chainId: number,
    cfg: ChainProviderConfig,
    addresses: string[],
  ): Promise<void> {
    if (!cfg.endpoint || !cfg.internalApiKey) return;
    try {
      const provider = new IndexerProvider(chainId, cfg.endpoint, cfg.internalApiKey);
      await provider.syncWatchAddresses(addresses);
      logger.info({ chainId, count: addresses.length }, '已同步 watch-addresses 至 Indexer');
    } catch (err) {
      logger.error({ err, chainId }, '同步 watch-addresses 失败');
    }
  }

  private resolveChainIds(chainIds: number[]): number[] {
    if (chainIds.length > 0) return chainIds;
    return this.router.listChainIds();
  }
}
