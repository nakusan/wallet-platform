import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createDbPools } from './infrastructure/db/pools.js';
import { WriteSemaphore } from './infrastructure/db/write-semaphore.js';
import { getRedis } from './infrastructure/cache/redis-client.js';
import { createChainClients } from './ingest/chain/viem-client.js';
import { IndexerApp } from './ingest/indexer-app.js';
import { NftHoldingSyncWorker } from './materialization/nft-holding-sync-worker.js';
import { EnrichQueue } from './enrich/enrich-queue.js';
import { EnrichSupportRepo } from './enrich/enrich-support-repo.js';
import { TransferLoader } from './enrich/transfer-loader.js';
import { ActivityWriter } from './enrich/activity-writer.js';
import { ActivityReorgService } from './enrich/activity-reorg-service.js';
import { TxEnrichmentWorker } from './enrich/tx-enrichment-worker.js';
import { EventPublisher } from './events/event-publisher.js';
import { NftMetadataWorker } from './metadata/nft-metadata-worker.js';
import { NativeTxWatcher } from './enrich/native-tx-watcher.js';
import { buildInternalApp } from './read-api/app.js';
import { logger } from './infrastructure/logger/logger.js';

async function main() {
  const env = loadEnv();
  const { api: apiPool, worker: workerPool } = createDbPools({
    databaseUrl: env.DATABASE_URL,
    apiMax: env.DB_API_POOL_MAX,
    workerMax: env.DB_WORKER_POOL_MAX,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    apiStatementTimeoutMs: env.DB_API_STATEMENT_TIMEOUT_MS,
    workerStatementTimeoutMs: env.DB_WORKER_STATEMENT_TIMEOUT_MS,
  });
  const writeSemaphore = new WriteSemaphore(env.DB_MAX_CONCURRENT_WRITE_TX);
  const redis = getRedis();
  const chain = createChainClients(env);

  const rpcChainId = await chain.http.getChainId();
  if (rpcChainId !== env.CHAIN_ID) {
    throw new Error(`CHAIN_ID=${env.CHAIN_ID} 与 RPC chainId=${rpcChainId} 不一致`);
  }

  const eventPublisher = new EventPublisher(env);
  const enrichQueue = new EnrichQueue(redis, env.CHAIN_ID);
  const enrichSupportRepo = new EnrichSupportRepo(workerPool, env.CHAIN_ID);
  const transferLoader = new TransferLoader(workerPool, env.CHAIN_ID);
  const activityWriter = new ActivityWriter(
    workerPool, env.CHAIN_ID, eventPublisher, writeSemaphore,
  );
  const activityReorgService = new ActivityReorgService(eventPublisher);

  const indexerApp = new IndexerApp(
    workerPool, env, chain, writeSemaphore, enrichQueue, activityReorgService,
  );
  const nftSyncWorker = new NftHoldingSyncWorker(
    workerPool, redis, env.CHAIN_ID, env.NFT_SYNC_INTERVAL_MS, writeSemaphore,
  );
  const enrichWorker = new TxEnrichmentWorker(
    workerPool,
    chain.http,
    enrichQueue,
    enrichSupportRepo,
    transferLoader,
    activityWriter,
    env.CHAIN_ID,
    env.ENRICH_INTERVAL_MS,
    env.ENRICH_BATCH_SIZE,
  );
  const metadataWorker = new NftMetadataWorker(
    workerPool, chain.http, redis, env.CHAIN_ID, env.METADATA_INTERVAL_MS,
  );
  const nativeTxWatcher = new NativeTxWatcher(
    workerPool,
    chain.http,
    redis,
    enrichQueue,
    env.CHAIN_ID,
    env,
    env.NATIVE_WATCH_INTERVAL_MS,
    env.NATIVE_WATCH_MAX_BLOCKS_PER_TICK,
  );

  const app = buildInternalApp(apiPool, redis, chain.http, env);
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, chainId: env.CHAIN_ID }, 'wallet-indexer internal API started');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '收到关闭信号');
    server.close();
    enrichWorker.stop();
    metadataWorker.stop();
    nativeTxWatcher.stop();
    nftSyncWorker.stop();
    await indexerApp.shutdown();
    await Promise.all([apiPool.end(), workerPool.end()]);
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await indexerApp.run();
  nftSyncWorker.start();
  enrichWorker.start();
  metadataWorker.start();
  nativeTxWatcher.start();

  logger.info({ chainId: env.CHAIN_ID }, 'wallet-indexer 已完全启动');
}

main().catch((err) => {
  logger.error({ err }, 'wallet-indexer 启动失败');
  process.exit(1);
});
