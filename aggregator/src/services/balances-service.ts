import type { PortfolioResponse } from '@wallet-platform/canonical';
import type { ProviderRouter } from '../providers/provider-router.js';
import type { PriceService } from './price-service.js';

export class BalancesService {
  constructor(
    private readonly router: ProviderRouter,
    private readonly priceService: PriceService,
  ) {}

  async getBalances(
    address: string,
    chainIds?: number[],
    withPricing = false,
  ): Promise<PortfolioResponse> {
    const ids = chainIds?.length ? chainIds : this.router.listChainIds();
    const results = await Promise.allSettled(
      ids.map(async (chainId) => {
        const balances = await this.router.get(chainId).getBalances(address);
        if (!withPricing) {
          return {
            chainId,
            status: 'ok' as const,
            data: {
              ...balances,
              native: { ...balances.native, valueUsd: null },
              tokens: balances.tokens.map((t) => ({ ...t, valueUsd: null })),
              chainTotalUsd: null,
            },
          };
        }
        const priced = await this.priceService.priceBalances(balances);
        const chainTotalUsd = await this.priceService.sumChainTotalUsd(priced);
        return {
          chainId,
          status: 'ok' as const,
          data: { ...priced, chainTotalUsd },
        };
      }),
    );

    const chains = results.map((r, i) => {
      const chainId = ids[i]!;
      if (r.status === 'fulfilled') return r.value;
      return { chainId, status: 'error' as const, error: String(r.reason) };
    });

    let totalValueUsd: string | null = null;
    if (withPricing) {
      const totals = chains
        .filter((c): c is Extract<typeof c, { status: 'ok' }> => c.status === 'ok' && c.data?.chainTotalUsd != null)
        .map((c) => Number(c.data.chainTotalUsd));
      if (totals.length > 0) {
        totalValueUsd = totals.reduce((a, b) => a + b, 0).toFixed(6);
      }
    }

    return {
      address: address.toLowerCase(),
      chains,
      totalValueUsd,
      partial: chains.some((c) => c.status === 'error'),
    };
  }
}
