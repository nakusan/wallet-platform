import type { Pool } from 'pg';
import type { NftTransferRecord, TransferRecord } from '../ingest/domain/types.js';

interface TokenTransferRow {
  chain_id: number;
  contract_address: string;
  symbol: string;
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_timestamp: Date | null;
  from_address: string;
  to_address: string;
  amount_raw: string;
  amount: string;
}

interface NftTransferRow {
  chain_id: number;
  contract_address: string;
  token_id: string;
  token_standard: string;
  tx_hash: string;
  log_index: number;
  batch_index: number;
  block_number: string;
  block_timestamp: Date | null;
  from_address: string;
  to_address: string;
  amount: string;
}

export class TransferLoader {
  constructor(
    private readonly pool: Pool,
    private readonly chainId: number,
  ) {}

  async loadByTxHash(txHash: string): Promise<{
    tokenTransfers: TransferRecord[];
    nftTransfers: NftTransferRecord[];
  }> {
    const hash = txHash.toLowerCase();
    const [tokenResult, nftResult] = await Promise.all([
      this.pool.query<TokenTransferRow>(
        `SELECT chain_id, contract_address, symbol, tx_hash, log_index,
                block_number, block_timestamp, from_address, to_address,
                amount_raw, amount
         FROM token_transfers
         WHERE chain_id=$1 AND tx_hash=$2 AND status='indexed'
         ORDER BY log_index`,
        [this.chainId, hash],
      ),
      this.pool.query<NftTransferRow>(
        `SELECT chain_id, contract_address, token_id, token_standard, tx_hash,
                log_index, batch_index, block_number, block_timestamp,
                from_address, to_address, amount
         FROM nft_transfers
         WHERE chain_id=$1 AND tx_hash=$2 AND status='indexed'
         ORDER BY log_index, batch_index`,
        [this.chainId, hash],
      ),
    ]);

    return {
      tokenTransfers: tokenResult.rows.map(mapTokenRow),
      nftTransfers: nftResult.rows.map(mapNftRow),
    };
  }
}

function mapTokenRow(row: TokenTransferRow): TransferRecord {
  return {
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    symbol: row.symbol,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: row.block_timestamp,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amountRaw: row.amount_raw,
    amount: row.amount,
  };
}

function mapNftRow(row: NftTransferRow): NftTransferRecord {
  return {
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    tokenId: BigInt(row.token_id),
    tokenStandard: row.token_standard as 'ERC721' | 'ERC1155',
    txHash: row.tx_hash,
    logIndex: row.log_index,
    batchIndex: row.batch_index,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: row.block_timestamp,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: BigInt(row.amount),
  };
}
