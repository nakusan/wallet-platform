import type { PortfolioResponse } from '@wallet-platform/canonical';
import type { ProviderRouter } from '../providers/provider-router.js';
import type { PriceService } from './price-service.js';

export class PortfolioService {
  constructor(
    private readonly router: ProviderRouter,
    private readonly priceService: PriceService,
  ) {}

  async getPortfolio(address: string, chainIds?: number[]): Promise<PortfolioResponse> {
    const ids = chainIds?.length ? chainIds : this.router.listChainIds();
    const results = await Promise.allSettled(
      ids.map(async (chainId) => {
        const balances = await this.router.get(chainId).getBalances(address);
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

    const totals = chains
      .filter((c): c is Extract<typeof c, { status: 'ok' }> => c.status === 'ok' && c.data?.chainTotalUsd != null)
      .map((c) => Number(c.data.chainTotalUsd));

    const totalValueUsd = totals.length > 0
      ? totals.reduce((a, b) => a + b, 0).toFixed(6)
      : null;

    return {
      address: address.toLowerCase(),
      chains,
      totalValueUsd,
      partial: chains.some((c) => c.status === 'error'),
    };
  }
}
