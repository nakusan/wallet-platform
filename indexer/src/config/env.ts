import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CHAIN_ID: z.coerce.number().int().positive().default(1),
  DATABASE_URL: z.string().min(1),
  DB_API_POOL_MAX: z.coerce.number().int().positive().default(8),
  DB_WORKER_POOL_MAX: z.coerce.number().int().positive().default(12),
  DB_MAX_CONCURRENT_WRITE_TX: z.coerce.number().int().positive().default(3),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_API_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  DB_WORKER_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  RPC_HTTP_URL: z.string().url(),
  RPC_WS_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  JSON_BODY_LIMIT: z.string().default('16kb'),
  INTERNAL_API_KEY: z.string().min(32),
  AGGREGATOR_EVENT_URL: z.string().url().optional(),
  CONFIRMATION_DEPTH: z.coerce.number().int().nonnegative().default(12),
  BACKFILL_MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(2000),
  BACKFILL_OVERLAP_BLOCKS: z.coerce.number().int().nonnegative().default(2),
  INDEXER_START_LOOKBACK_BLOCKS: z.coerce.number().int().nonnegative().default(100_000),
  REORG_SCAN_DEPTH: z.coerce.number().int().positive().default(128),
  REORG_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  GAP_BACKFILL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  MAX_INLINE_GAP_BLOCKS: z.coerce.number().int().positive().default(500),
  ANCHOR_PREFETCH_CONCURRENCY: z.coerce.number().int().positive().default(32),
  NFT_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  ENRICH_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  ENRICH_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  METADATA_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  NATIVE_WATCH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  NATIVE_WATCH_MAX_BLOCKS_PER_TICK: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FILE: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('环境变量无效:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
