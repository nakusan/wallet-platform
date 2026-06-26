# wallet-platform

钱包后端平台总仓：两个**独立工程**，独立构建与发布。

```
wallet-platform/
├── indexer/          # wallet-indexer：一实例一链
├── aggregator/       # wallet-aggregator：对外网关
└── shared/canonical/ # 共享契约类型（非服务）
```

## 快速开始

```bash
# 安装依赖
pnpm install

# Indexer（需 PostgreSQL、Redis、RPC）
cp indexer/.env.example indexer/.env
cd indexer && pnpm migrate && pnpm dev

# Aggregator（另开终端）
cp aggregator/.env.example aggregator/.env
cd aggregator && pnpm migrate && pnpm dev
```

## 设计文档

完整 v3 设计方案、代码映射与**未完成项清单**见：

**[docs/DESIGN-v3.md](docs/DESIGN-v3.md)**

Agent 实施时请优先阅读该文档 §10 任务 ID（如 `I-01`、`A-04`）。

## 服务边界

| | Indexer | Aggregator |
|--|---------|------------|
| 索引 / reorg | ✅ | ❌ |
| NFT 物化 | ✅ | ❌ |
| Enrich | ✅ | ❌ |
| Metadata | ⚠️ 占位 | ❌ |
| 跨链 Portfolio / Activity | ❌ | ⚠️ 骨架 |
| JWT 用户鉴权 | ❌ | ⚠️ migration 待修 |
| Webhook | 产生事件（EventPublisher 已接线） | 订阅与投递（待实现） |

## 发布

每个工程独立 Docker 镜像与 CI：

- `indexer/Dockerfile` → `wallet-indexer:${TAG}`
- `aggregator/Dockerfile` → `wallet-aggregator:${TAG}`

## 实施进度（摘要）

详见 [docs/DESIGN-v3.md §10](docs/DESIGN-v3.md#10-实施检查清单与未完成项)。

- **已完成**：工程拆分、ERC20/NFT 索引与 reorg、NFT 物化、RPC 余额读、Internal API 骨架、Tx Enrich + EventPublisher、Aggregator JWT/路由骨架
- **P0 待办**：Webhook 全链路（Aggregator ChainEventConsumer）、`api_keys` migration 修复
- **P1 待办**：NftMetadata、Alchemy Provider、CoinGecko 计价
