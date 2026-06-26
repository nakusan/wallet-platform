import type { CanonicalNftPage } from '@wallet-platform/canonical';
import type { ProviderRouter } from '../providers/provider-router.js';

export interface GlobalNftPage {
  address: string;
  chains: Array<{
    chainId: number;
    status: 'ok' | 'error';
    error?: string;
    data?: CanonicalNftPage;
  }>;
  partial: boolean;
}

export class NftsService {
  constructor(private readonly router: ProviderRouter) {}

  async getNfts(
    address: string,
    opts: { chainIds?: number[]; limit?: number; cursor?: string } = {},
  ): Promise<GlobalNftPage> {
    const ids = opts.chainIds?.length ? opts.chainIds : this.router.listChainIds();
    const limit = opts.limit ? Math.min(opts.limit, 200) : undefined;

    const results = await Promise.allSettled(
      ids.map((chainId) => this.router.get(chainId).getNfts(address, {
        limit,
        cursor: opts.cursor,
      })),
    );

    const chains = results.map((r, i) => {
      const chainId = ids[i]!;
      if (r.status === 'fulfilled') {
        return { chainId, status: 'ok' as const, data: r.value };
      }
      return { chainId, status: 'error' as const, error: String(r.reason) };
    });

    return {
      address: address.toLowerCase(),
      chains,
      partial: chains.some((c) => c.status === 'error'),
    };
  }
}
