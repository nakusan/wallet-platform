import type { CanonicalActivityPage, CanonicalBalances, CanonicalNftPage } from '@wallet-platform/canonical';
import type { ChainProvider, ProviderHealth } from '../chain-provider.js';

export class IndexerProvider implements ChainProvider {
  readonly type = 'indexer' as const;

  constructor(
    readonly chainId: number,
    private readonly endpoint: string,
    private readonly internalApiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Internal-Api-Key': this.internalApiKey,
    };
  }

  async getBalances(address: string): Promise<CanonicalBalances> {
    const res = await fetch(
      `${this.endpoint}/internal/v1/address/${address}/balances`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`indexer balances ${res.status}`);
    return res.json() as Promise<CanonicalBalances>;
  }

  async getNfts(
    address: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<CanonicalNftPage> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    const url = `${this.endpoint}/internal/v1/address/${address}/nfts${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`indexer nfts ${res.status}`);
    return res.json() as Promise<CanonicalNftPage>;
  }

  async getActivity(
    address: string,
    opts: { limit?: number; cursor?: string; types?: string[] } = {},
  ): Promise<CanonicalActivityPage> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.types?.length) params.set('types', opts.types.join(','));
    const qs = params.toString();
    const url = `${this.endpoint}/internal/v1/address/${address}/activity${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`indexer activity ${res.status}`);
    return res.json() as Promise<CanonicalActivityPage>;
  }

  async syncWatchAddresses(addresses: string[]): Promise<void> {
    const res = await fetch(`${this.endpoint}/internal/v1/watch-addresses/sync`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ addresses }),
    });
    if (!res.ok) throw new Error(`indexer watch-addresses sync ${res.status}`);
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.endpoint}/internal/v1/health`, { headers: this.headers() });
      return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `status ${res.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }
}
