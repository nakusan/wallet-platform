import type { Pool } from 'pg';
import type { Env } from '../config/env.js';
import type { ChainClients } from './chain/viem-client.js';
import { getSafeBlockNumber, getFinalizedBlockNumber } from './chain/viem-client.js';
import { NftHoldingRewinder } from '../materialization/nft-holding-rewinder.js';
import { ContractRepo } from './db/contract-repo.js';
import { CheckpointRepo } from './db/checkpoint-repo.js';
import { ChainStateRepo } from './db/chain-state-repo.js';
import { BlockAnchorRepo } from './db/block-anchor-repo.js';
import { ContractWriteCoordinator } from './util/contract-write-coordinator.js';
import {
  ChainReorgCoordinator,
  createChainReorgCoordinator,
} from './service/chain-reorg-coordinator.js';
import type { EnrichQueue } from '../enrich/enrich-queue.js';
import type { ActivityReorgHandler } from '../enrich/activity-reorg-service.js';
import { FinalizedPersistService } from './service/finalized-persist-service.js';
import { ChainAnchorService } from './service/chain-anchor-service.js';
import { Erc20TransferRepo } from './erc20/transfer-repo.js';
import { Erc20BackfillService } from './erc20/backfill-service.js';
import { Erc20LiveWatcher } from './erc20/live-watcher.js';
import { NftTransferRepo } from './nft/transfer-repo.js';
import { NftBackfillService } from './nft/backfill-service.js';
import { NftLiveWatcher } from './nft/live-watcher.js';
import type { MonitoredContract, NftTransferRecord, TransferRecord } from './domain/types.js';
import { logger } from '../infrastructure/logger/logger.js';
import type { WriteSemaphore } from '../infrastructure/db/write-semaphore.js';
import { resolveStartBlock, resolveIndexWindowStart } from './util/resolve-start-block.js';
import { NftSyncStateRepo } from '../materialization/nft-sync-state-repo.js';

export class IndexerApp {
  private erc20LiveWatcher: Erc20LiveWatcher | null = null;
  private nftLiveWatcher: NftLiveWatcher | null = null;
  private reorgTimer: ReturnType<typeof setInterval> | null = null;
  private gapBackfillTimer: ReturnType<typeof setInterval> | null = null;
  private gapBackfillRunning = false;
  private chainReorgCoordinator: ChainReorgCoordinator | null = null;

  private readonly contractRepo: ContractRepo;
  private readonly checkpointRepo: CheckpointRepo;
  private readonly chainStateRepo: ChainStateRepo;
  private readonly blockAnchorRepo: BlockAnchorRepo;
  private readonly chainAnchorService: ChainAnchorService;
  private readonly erc20TransferRepo: Erc20TransferRepo;
  private readonly nftTransferRepo: NftTransferRepo;
  private readonly nftSyncStateRepo = new NftSyncStateRepo();

  constructor(
    private readonly pool: Pool,
    private readonly env: Env,
    private readonly chain: ChainClients,
    private readonly writeSemaphore: WriteSemaphore,
    private readonly enrichQueue: EnrichQueue | null = null,
    private readonly activityReorgHandler: ActivityReorgHandler | null = null,
  ) {
    this.contractRepo = new ContractRepo(pool);
    this.checkpointRepo = new CheckpointRepo(pool);
    this.chainStateRepo = new ChainStateRepo(pool);
    this.blockAnchorRepo = new BlockAnchorRepo(pool);
    this.chainAnchorService = new ChainAnchorService(
      pool, env, chain.http, this.blockAnchorRepo, writeSemaphore,
    );
    this.erc20TransferRepo = new Erc20TransferRepo(pool);
    this.nftTransferRepo = new NftTransferRepo(pool);
  }

  async run(): Promise<void> {
    logger.info({ flow: 'indexer.init' }, '索引器初始化开始');
    await this.chainStateRepo.ensureInitialized(this.env.CHAIN_ID);
    await this.chainStateRepo.syncFromContractMinOnPool(this.env.CHAIN_ID);
    await this.updateFinalizedBlock();

    const safeLatest = await getSafeBlockNumber(this.chain.http, this.env.CONFIRMATION_DEPTH);
    logger.info(
      { flow: 'indexer.init', safeLatest: safeLatest.toString(), confirmationDepth: this.env.CONFIRMATION_DEPTH },
      '已获取安全块高',
    );

    const coordinator = createChainReorgCoordinator(
      this.pool, this.env, this.chain.http,
      this.chainStateRepo, this.blockAnchorRepo, this.chainAnchorService,
      this.checkpointRepo, this.writeSemaphore,
      this.activityReorgHandler ?? undefined,
    );
    this.chainReorgCoordinator = coordinator;

    await this.setupErc20(coordinator);
    await this.setupNft(coordinator);
    await coordinator.scanAndRepair();

    await this.startErc20(safeLatest, coordinator);
    await this.startNft(safeLatest, coordinator);

    this.reorgTimer = setInterval(
      () => void this.runReorgScanTick(),
      this.env.REORG_SCAN_INTERVAL_MS,
    );
    this.gapBackfillTimer = setInterval(
      () => void this.runGapBackfillTick(),
      this.env.GAP_BACKFILL_INTERVAL_MS,
    );

    logger.info({ safeLatest: safeLatest.toString(), flow: 'indexer.init' }, '索引器（ERC20+NFT）已启动');
  }

  async shutdown(): Promise<void> {
    if (this.gapBackfillTimer) {
      clearInterval(this.gapBackfillTimer);
      this.gapBackfillTimer = null;
    }
    if (this.reorgTimer) {
      clearInterval(this.reorgTimer);
      this.reorgTimer = null;
    }
    await this.erc20LiveWatcher?.shutdown();
    await this.nftLiveWatcher?.shutdown();
    logger.info('索引器已关闭');
  }

  private erc20WriteCoordinator: ContractWriteCoordinator | null = null;
  private erc20Backfill: Erc20BackfillService | null = null;
  private erc20Contracts: Awaited<ReturnType<ContractRepo['findActive']>> = [];

  private async setupErc20(coordinator: ChainReorgCoordinator): Promise<void> {
    const contracts = await this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC20');
    if (contracts.length === 0) {
      logger.warn({ flow: 'indexer.erc20' }, '无活跃 ERC20 合约');
      return;
    }
    this.erc20Contracts = contracts;

    const writeCoordinator = new ContractWriteCoordinator();
    this.erc20WriteCoordinator = writeCoordinator;

    const persistService = this.createErc20PersistService();

    const backfill = new Erc20BackfillService(
      this.env, this.chain.http, writeCoordinator, persistService, coordinator,
      this.chainAnchorService, this.pool, this.checkpointRepo,
      this.chainStateRepo, this.blockAnchorRepo, this.writeSemaphore,
    );
    this.erc20Backfill = backfill;

    coordinator.register({
      indexerType: 'erc20',
      writeCoordinator,
      liveWatcher: null,
      repos: [this.erc20TransferRepo],
      rewinders: [],
      backfill,
      getContracts: () => this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC20'),
    }, persistService);
  }

  private async startErc20(safeLatest: bigint, coordinator: ChainReorgCoordinator): Promise<void> {
    if (this.erc20Contracts.length === 0 || !this.erc20WriteCoordinator || !this.erc20Backfill) return;

    const writeCoordinator = this.erc20WriteCoordinator;
    const backfill = this.erc20Backfill;
    const contracts = this.erc20Contracts;

    const persistService = this.createErc20PersistService();

    for (const contract of contracts) {
      const checkpoint = await this.checkpointRepo.get(contract.chainId, contract.address, 'erc20');
      await this.ensureStartBlockPersisted(contract, safeLatest, 'erc20', checkpoint);
      const start = resolveStartBlock({
        contract, checkpoint, safeLatest,
        lookbackBlocks: BigInt(this.env.INDEXER_START_LOOKBACK_BLOCKS),
      });
      if (start <= safeLatest) await backfill.fillSegmented(contract, start, safeLatest);
    }

    const resumeFrom = safeLatest - BigInt(this.env.BACKFILL_OVERLAP_BLOCKS) > 0n
      ? safeLatest - BigInt(this.env.BACKFILL_OVERLAP_BLOCKS) : 0n;

    const liveWatcher = new Erc20LiveWatcher(
      this.env, this.chain.ws, writeCoordinator, persistService, coordinator,
      async () => {
        for (const contract of contracts) {
          const checkpoint = await this.checkpointRepo.get(contract.chainId, contract.address, 'erc20');
          const latest = await getSafeBlockNumber(this.chain.http, this.env.CONFIRMATION_DEPTH);
          const from = resolveStartBlock({
            contract, checkpoint, safeLatest: latest,
            lookbackBlocks: BigInt(this.env.INDEXER_START_LOOKBACK_BLOCKS),
          });
          if (from <= latest) await backfill.fillSegmented(contract, from, latest);
        }
      },
    );
    this.erc20LiveWatcher = liveWatcher;
    coordinator.attachLiveWatcher('erc20', liveWatcher);
    liveWatcher.start(contracts, resumeFrom);
  }

  private nftWriteCoordinator: ContractWriteCoordinator | null = null;
  private nftBackfill: NftBackfillService | null = null;
  private nftContracts: Awaited<ReturnType<ContractRepo['findActive']>> = [];

  private async setupNft(coordinator: ChainReorgCoordinator): Promise<void> {
    const contracts721 = await this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC721');
    const contracts1155 = await this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC1155');
    const contracts = [...contracts721, ...contracts1155];
    if (contracts.length === 0) {
      logger.info('无活跃 NFT 合约，跳过 NFT 索引');
      return;
    }
    this.nftContracts = contracts;

    const writeCoordinator = new ContractWriteCoordinator();
    this.nftWriteCoordinator = writeCoordinator;

    const persistService = this.createNftPersistService();

    const backfill = new NftBackfillService(
      this.env, this.chain.http, writeCoordinator, persistService, coordinator,
      this.nftTransferRepo, this.chainAnchorService, this.pool,
      this.checkpointRepo, this.chainStateRepo, this.blockAnchorRepo, this.writeSemaphore,
    );
    this.nftBackfill = backfill;

    coordinator.register({
      indexerType: 'nft',
      writeCoordinator,
      liveWatcher: null,
      repos: [this.nftTransferRepo],
      rewinders: [new NftHoldingRewinder()],
      backfill,
      getContracts: async () => {
        const c721 = await this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC721');
        const c1155 = await this.contractRepo.findActive(this.env.CHAIN_ID, 'ERC1155');
        return [...c721, ...c1155];
      },
    }, persistService);
  }

  private async startNft(safeLatest: bigint, coordinator: ChainReorgCoordinator): Promise<void> {
    if (this.nftContracts.length === 0 || !this.nftWriteCoordinator || !this.nftBackfill) return;

    const writeCoordinator = this.nftWriteCoordinator;
    const backfill = this.nftBackfill;
    const contracts = this.nftContracts;

    const persistService = this.createNftPersistService();

    for (const contract of contracts) {
      const checkpoint = await this.checkpointRepo.get(contract.chainId, contract.address, 'nft');
      await this.ensureStartBlockPersisted(contract, safeLatest, 'nft', checkpoint);
      const start = resolveStartBlock({
        contract, checkpoint, safeLatest,
        lookbackBlocks: BigInt(this.env.INDEXER_START_LOOKBACK_BLOCKS),
      });
      if (start <= safeLatest) await backfill.fillSegmented(contract, start, safeLatest);
    }

    const resumeFrom = safeLatest - BigInt(this.env.BACKFILL_OVERLAP_BLOCKS) > 0n
      ? safeLatest - BigInt(this.env.BACKFILL_OVERLAP_BLOCKS) : 0n;

    const liveWatcher = new NftLiveWatcher(
      this.env, this.chain.ws, writeCoordinator, persistService, coordinator,
      async () => {
        for (const contract of contracts) {
          const checkpoint = await this.checkpointRepo.get(contract.chainId, contract.address, 'nft');
          const latest = await getSafeBlockNumber(this.chain.http, this.env.CONFIRMATION_DEPTH);
          const from = resolveStartBlock({
            contract, checkpoint, safeLatest: latest,
            lookbackBlocks: BigInt(this.env.INDEXER_START_LOOKBACK_BLOCKS),
          });
          if (from <= latest) await backfill.fillSegmented(contract, from, latest);
        }
      },
    );
    this.nftLiveWatcher = liveWatcher;
    coordinator.attachLiveWatcher('nft', liveWatcher);
    liveWatcher.start(contracts, resumeFrom);
  }

  private async updateFinalizedBlock(): Promise<void> {
    const finalized = await getFinalizedBlockNumber(this.chain.http, this.env);
    await this.chainStateRepo.setFinalizedBlock(this.env.CHAIN_ID, finalized);
  }

  private async runReorgScanTick(): Promise<void> {
    try {
      await this.updateFinalizedBlock();
      await this.chainReorgCoordinator?.scanAndRepair();
    } catch (err) {
      logger.error({ err }, '定时 reorg 扫描失败');
    }
  }

  private async runGapBackfillTick(): Promise<void> {
    if (this.gapBackfillRunning) return;
    this.gapBackfillRunning = true;
    try {
      const safeLatest = await getSafeBlockNumber(this.chain.http, this.env.CONFIRMATION_DEPTH);
      await this.gapBackfillErc20(safeLatest);
      await this.gapBackfillNft(safeLatest);
    } catch (err) {
      logger.error({ err, flow: 'gap.backfill' }, '定时 gap-backfill 失败');
    } finally {
      this.gapBackfillRunning = false;
    }
  }

  private async gapBackfillErc20(safeLatest: bigint): Promise<void> {
    if (!this.erc20Backfill || this.erc20Contracts.length === 0) return;
    for (const contract of this.erc20Contracts) {
      const checkpoint = await this.checkpointRepo.get(
        contract.chainId, contract.address, 'erc20',
      );
      if (checkpoint == null) continue;
      const from = checkpoint + 1n;
      if (from > safeLatest) continue;
      await this.erc20Backfill.fillSegmented(contract, from, safeLatest);
    }
  }

  private async gapBackfillNft(safeLatest: bigint): Promise<void> {
    if (!this.nftBackfill || this.nftContracts.length === 0) return;
    for (const contract of this.nftContracts) {
      const checkpoint = await this.checkpointRepo.get(
        contract.chainId, contract.address, 'nft',
      );
      if (checkpoint == null) continue;
      const from = checkpoint + 1n;
      if (from > safeLatest) continue;
      await this.nftBackfill.fillSegmented(contract, from, safeLatest);
    }
  }

  private async ensureStartBlockPersisted(
    contract: MonitoredContract,
    safeLatest: bigint,
    syncType: 'erc20' | 'nft',
    checkpoint: bigint | null,
  ): Promise<void> {
    if (contract.startBlock != null) return;
    if (syncType === 'erc20') return;

    const resolved = checkpoint == null
      ? resolveIndexWindowStart({
        startBlock: null,
        safeLatest,
        lookbackBlocks: BigInt(this.env.INDEXER_START_LOOKBACK_BLOCKS),
      })
      : await this.getMinIndexedBlock(contract.chainId, contract.address, syncType);

    if (resolved == null) return;

    const updated = await this.contractRepo.setStartBlockIfNull(
      contract.chainId, contract.address, resolved,
    );
    if (!updated) return;

    contract.startBlock = resolved;
    await this.nftSyncStateRepo.rewindBelowIfNeeded(
      this.pool, contract.chainId, contract.address, resolved - 1n,
    );
    logger.info(
      {
        flow: 'indexer.contract',
        symbol: contract.symbol,
        startBlock: resolved.toString(),
        source: checkpoint == null ? 'lookback' : 'min_indexed_block',
      },
      'start_block 已初始化',
    );
  }

  private async getMinIndexedBlock(
    chainId: number,
    contractAddress: string,
    syncType: 'erc20' | 'nft',
  ): Promise<bigint | null> {
    const table = syncType === 'erc20' ? 'token_transfers' : 'nft_transfers';
    const { rows } = await this.pool.query(
      `SELECT MIN(block_number)::text AS min_block FROM ${table}
       WHERE chain_id=$1 AND contract_address=$2 AND status='indexed'`,
      [chainId, contractAddress.toLowerCase()],
    );
    const val = rows[0]?.min_block;
    return val != null ? BigInt(val as string) : null;
  }

  private onPersistedCallback(txHashes: string[]): Promise<void> | void {
    if (!this.enrichQueue) return;
    return this.enrichQueue.enqueue(txHashes);
  }

  private createErc20PersistService(): FinalizedPersistService<TransferRecord> {
    return new FinalizedPersistService(
      this.pool, this.env, this.chain.http,
      this.erc20TransferRepo, this.checkpointRepo,
      this.blockAnchorRepo, this.chainStateRepo,
      'erc20', this.writeSemaphore,
      this.enrichQueue ? (txHashes) => this.onPersistedCallback(txHashes) : undefined,
    );
  }

  private createNftPersistService(): FinalizedPersistService<NftTransferRecord> {
    return new FinalizedPersistService(
      this.pool, this.env, this.chain.http,
      this.nftTransferRepo, this.checkpointRepo,
      this.blockAnchorRepo, this.chainStateRepo,
      'nft', this.writeSemaphore,
      this.enrichQueue ? (txHashes) => this.onPersistedCallback(txHashes) : undefined,
    );
  }
}
