import { z } from 'zod';

const chainProviderSchema = z.object({
  provider: z.enum(['indexer', 'alchemy']),
  endpoint: z.string().url().optional(),
  internalApiKey: z.string().optional(),
  apiKey: z.string().optional(),
  network: z.string().optional(),
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  CORS_ORIGINS: z.string().optional(),
  JSON_BODY_LIMIT: z.string().default('16kb'),
  INTERNAL_API_KEY: z.string().min(32).optional(),
  COINGECKO_API_KEY: z.string().optional(),
  PRICE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CHAINS_JSON: z.string().default('{}'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FILE: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;
export type ChainProviderConfig = z.infer<typeof chainProviderSchema>;

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

export function loadChainProviders(): Record<string, ChainProviderConfig> {
  const env = loadEnv();
  const raw = JSON.parse(env.CHAINS_JSON) as Record<string, unknown>;
  const out: Record<string, ChainProviderConfig> = {};
  for (const [chainId, cfg] of Object.entries(raw)) {
    out[chainId] = chainProviderSchema.parse(cfg);
  }
  return out;
}
