import type { Pool } from 'pg';

const CACHE_TTL_MS = 60_000;

export class EnrichSupportRepo {
  private knownContractsCache: { loadedAt: number; map: Map<string, string> } | null = null;
  private methodSignaturesCache: { loadedAt: number; map: Map<string, string> } | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly chainId: number,
  ) {}

  async getKnownContracts(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.knownContractsCache && now - this.knownContractsCache.loadedAt < CACHE_TTL_MS) {
      return this.knownContractsCache.map;
    }

    const { rows } = await this.pool.query<{ address: string; protocol: string }>(
      `SELECT address, protocol FROM known_contracts WHERE chain_id=$1`,
      [this.chainId],
    );
    const map = new Map(rows.map((r) => [r.address.toLowerCase(), r.protocol]));
    this.knownContractsCache = { loadedAt: now, map };
    return map;
  }

  async getMethodSignatures(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.methodSignaturesCache && now - this.methodSignaturesCache.loadedAt < CACHE_TTL_MS) {
      return this.methodSignaturesCache.map;
    }

    const { rows } = await this.pool.query<{ selector: string; method_name: string }>(
      `SELECT selector, method_name FROM method_signatures`,
    );
    const map = new Map(
      rows.map((r) => [r.selector.toLowerCase(), r.method_name]),
    );
    this.methodSignaturesCache = { loadedAt: now, map };
    return map;
  }
}
