import type { ChainProviderConfig } from '../config/env.js';
import { AlchemyProvider } from './alchemy/alchemy-provider.js';
import { IndexerProvider } from './indexer/indexer-provider.js';
import type { ChainProvider } from './chain-provider.js';

export class ProviderRouter {
  constructor(private readonly providers: Map<number, ChainProvider>) {}

  get(chainId: number): ChainProvider {
    const p = this.providers.get(chainId);
    if (!p) throw new Error(`unsupported chainId=${chainId}`);
    return p;
  }

  listChainIds(): number[] {
    return [...this.providers.keys()].sort((a, b) => a - b);
  }
}

export function buildProviderRouter(configs: Record<string, ChainProviderConfig>): ProviderRouter {
  const map = new Map<number, ChainProvider>();
  for (const [chainIdStr, cfg] of Object.entries(configs)) {
    const chainId = Number(chainIdStr);
    if (cfg.provider === 'indexer') {
      if (!cfg.endpoint || !cfg.internalApiKey) {
        throw new Error(`chain ${chainId}: indexer requires endpoint and internalApiKey`);
      }
      map.set(chainId, new IndexerProvider(chainId, cfg.endpoint, cfg.internalApiKey));
    } else if (cfg.provider === 'alchemy') {
      if (!cfg.apiKey || !cfg.network) {
        throw new Error(`chain ${chainId}: alchemy requires apiKey and network`);
      }
      map.set(chainId, new AlchemyProvider(chainId, cfg.apiKey, cfg.network));
    }
  }
  return new ProviderRouter(map);
}
