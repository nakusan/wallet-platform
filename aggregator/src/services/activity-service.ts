import type { CanonicalActivityItem } from '@wallet-platform/canonical';
import type { ProviderRouter } from '../providers/provider-router.js';
import {
  dedupeActivities,
  emptyGlobalCursor,
  encodeGlobalActivityCursor,
  parseGlobalActivityCursor,
  sortActivities,
  type GlobalActivityCursor,
} from './activity-cursor.js';

export interface GlobalActivityPage {
  address: string;
  data: CanonicalActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
  partial: boolean;
}

interface ChainFetchResult {
  chainId: number;
  items: CanonicalActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
  fetchCursor: string | null;
}

export class ActivityService {
  constructor(private readonly router: ProviderRouter) {}

  async getActivity(
    address: string,
    opts: { chainIds?: number[]; limit?: number; cursor?: string; types?: string[] } = {},
  ): Promise<GlobalActivityPage> {
    const ids = opts.chainIds?.length ? opts.chainIds : this.router.listChainIds();
    const limit = Math.min(opts.limit ?? 20, 100);
    const globalCursor = opts.cursor
      ? parseGlobalActivityCursor(opts.cursor)
      : emptyGlobalCursor();

    const chainResults = await Promise.allSettled(
      ids.map((chainId) => this.fetchChain(address, chainId, limit, globalCursor, opts.types)),
    );

    let partial = false;
    const freshItems: CanonicalActivityItem[] = [];
    const nextPerChain: GlobalActivityCursor['perChain'] = { ...globalCursor.perChain };
    let anyHasMore = false;

    for (let i = 0; i < chainResults.length; i++) {
      const chainId = ids[i]!;
      const r = chainResults[i]!;
      if (r.status === 'rejected') {
        partial = true;
        continue;
      }
      freshItems.push(...r.value.items);
      anyHasMore = anyHasMore || r.value.hasMore;
      nextPerChain[String(chainId)] = this.resolveNextChainCursor(
        globalCursor,
        r.value,
      );
    }

    const merged = dedupeActivities([
      ...globalCursor.buffer,
      ...freshItems,
    ]);
    const sorted = sortActivities(merged);
    const page = sorted.slice(0, limit);
    const remainder = sorted.slice(limit);

    const hasMore = remainder.length > 0 || anyHasMore;

    const nextCursor = hasMore
      ? encodeGlobalActivityCursor({
        v: 1,
        perChain: nextPerChain,
        buffer: remainder,
      })
      : null;

    return {
      address: address.toLowerCase(),
      data: page,
      nextCursor,
      hasMore,
      partial,
    };
  }

  private async fetchChain(
    address: string,
    chainId: number,
    limit: number,
    globalCursor: GlobalActivityCursor,
    types?: string[],
  ): Promise<ChainFetchResult> {
    const key = String(chainId);
    const fetchCursor = globalCursor.perChain[key] ?? null;
    const page = await this.router.get(chainId).getActivity(address, {
      limit,
      cursor: fetchCursor ?? undefined,
      types,
    });

    const bufferIds = new Set(globalCursor.buffer.map((b) => b.id));
    const items = page.data.filter((item) => !bufferIds.has(item.id));

    return {
      chainId,
      items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      fetchCursor,
    };
  }

  /** 若本批 items 全部进入合并池且无 buffer 残留，则推进 provider cursor。 */
  private resolveNextChainCursor(
    globalCursor: GlobalActivityCursor,
    result: ChainFetchResult,
  ): string | null {
    const key = String(result.chainId);
    const prev = globalCursor.perChain[key] ?? null;

    if (!result.hasMore) {
      return result.nextCursor ?? prev;
    }

    const consumedFromChain = globalCursor.buffer.filter((b) => b.chainId === result.chainId);
    const stillBuffered = consumedFromChain.length > 0;

    if (stillBuffered) {
      return prev;
    }

    if (result.items.length === 0) {
      return prev;
    }

    return result.nextCursor ?? prev;
  }
}
