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

/**
 * 多链 Activity 聚合分页。
 *
 * 客户端只看到一个 cursor；内部 GlobalActivityCursor 含两部分：
 * - perChain：每条链在 provider（Alchemy/indexer）侧的分页位置
 * - buffer：多链合并排序后超出 limit、尚未返回给客户端的活动
 *
 * 单次请求流水线：读 globalCursor → 各链并行拉取 → buffer+fresh 合并排序
 * → 切页（page 返回，remainder 写入下次 buffer）→ 编码 nextCursor。
 */
export class ActivityService {
  constructor(private readonly router: ProviderRouter) {}

  async getActivity(
    address: string,
    opts: { chainIds?: number[]; limit?: number; cursor?: string; types?: string[] } = {},
  ): Promise<GlobalActivityPage> {
    const ids = opts.chainIds?.length ? opts.chainIds : this.router.listChainIds();
    const limit = Math.min(opts.limit ?? 20, 100);

    // ① 入口：首页 emptyGlobalCursor()；翻页 parseGlobalActivityCursor() 还原 perChain + buffer
    const globalCursor = opts.cursor
      ? parseGlobalActivityCursor(opts.cursor)
      : emptyGlobalCursor();

    // ② 各链并行拉取；perChain[chainId] 作为 provider cursor 传入 fetchChain
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
      // 本链 provider 是否推进到下一页（buffer 仍有该链数据时不推进）
      nextPerChain[String(chainId)] = this.resolveNextChainCursor(
        globalCursor,
        r.value,
      );
    }

    // ③ 合并：上次未返回的 buffer + 本次各链新数据 → 去重 → 按时间降序
    const merged = dedupeActivities([
      ...globalCursor.buffer,
      ...freshItems,
    ]);
    const sorted = sortActivities(merged);

    // ④ 切页：前 limit 条给用户；其余写入下次 buffer
    const page = sorted.slice(0, limit);
    const remainder = sorted.slice(limit);

    const hasMore = remainder.length > 0 || anyHasMore;

    // ⑤ 打包 nextCursor（base64url）；客户端原样带回即可翻页
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

  /** 单链拉取：用 globalCursor.perChain[chainId] 作为 provider 分页 cursor。 */
  private async fetchChain(
    address: string,
    chainId: number,
    limit: number,
    globalCursor: GlobalActivityCursor,
    types?: string[],
  ): Promise<ChainFetchResult> {
    const key = String(chainId);
    // null = 该链第一页；非 null = 上次保存的 provider cursor（如 Alchemy pageKey）
    const fetchCursor = globalCursor.perChain[key] ?? null;
    const page = await this.router.get(chainId).getActivity(address, {
      limit,
      cursor: fetchCursor ?? undefined,
      types,
    });

    // buffer 里已有的 id 不再计入 freshItems，避免合并时重复
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

  /**
   * 决定本链下次请求的 provider cursor。
   * 仅当该链 buffer 已清空且本批有新数据时才推进；否则保持 prev，避免跳过未返回的活动。
   */
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
