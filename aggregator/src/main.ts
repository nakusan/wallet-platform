import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createPool } from './infrastructure/db/pool.js';
import { getRedis } from './infrastructure/cache/redis-client.js';
import { buildAggregatorApp } from './api/app.js';
import { logger } from './infrastructure/logger/logger.js';

async function main() {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL, { max: 8, application_name: 'wallet-aggregator' });
  const redis = getRedis();

  const app = buildAggregatorApp(pool, redis, env);
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'wallet-aggregator started');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到关闭信号');
    server.close();
    await pool.end();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'wallet-aggregator 启动失败');
  process.exit(1);
});
