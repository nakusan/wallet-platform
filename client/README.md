# Wallet Platform 测试客户端（client）

这是一个用于**联动测试 `aggregator` 后端**的轻量 Web 客户端。目标是让接口返回“更容易观察与定位问题”，而不是做完整产品 UI。

## 业务定位

- **联调/回归工具**：验证 Aggregator 的鉴权、限流、资产/活动聚合分页、Webhook CRUD 与投递链路。
- **可观测优先**：页面顶部有“请求面板”，记录每次请求的 URL、耗时、状态码，并可展开查看响应体。
- **结构化展示**：Balances / Activity / Portfolio / NFTs 默认用表格/卡片展示关键字段，同时保留 Raw JSON（折叠）用于排障。

## 功能清单

### 1）设置 / 鉴权

- 使用 `apiKey` 换取 JWT：`POST /v1/auth/token`
- 将 `token` 持久化到 `localStorage`，用于后续请求自动携带 `Authorization: Bearer <token>`
- 支持展示/复制/清空 token

### 2）地址查询

输入钱包地址后，可独立触发以下请求（互不影响，方便单独联调）：

- **Balances**：`GET /v1/address/:addr/balances?chainIds=&withPricing=1`
- **Activity**：`GET /v1/address/:addr/activity?chainIds=&limit=&cursor=&types=`
  - 支持 **加载更多**（基于 `nextCursor`）
- **Portfolio**：`GET /v1/address/:addr/portfolio?chainIds=`
- **NFTs**：`GET /v1/address/:addr/nfts?chainIds=&limit=&cursor=`
  - 支持 **加载更多**（基于 `nextCursor`）

展示说明：

- Activity / NFTs 会在响应中读取 `nextCursor`，存在时显示“加载更多”按钮
- 对结构化展示覆盖不到的字段，可展开 “Raw JSON” 查看完整响应

### 3）Webhook

用于联调 Webhook 管理与投递状态：

- 创建订阅：`POST /v1/webhooks`
  - 创建成功时后端会返回一次 `secret`（只此一次）用于接收端验签，页面会高亮展示并支持复制
- 列表：`GET /v1/webhooks`
- 更新/启停：`PATCH /v1/webhooks/:id`
- 删除：`DELETE /v1/webhooks/:id`
- 测试投递：`POST /v1/webhooks/:id/test`
- 查看投递记录：`GET /v1/webhooks/:id/deliveries?limit=`

## 运行与配置

### 前置条件

- Node.js / pnpm（仓库已使用 pnpm workspace）
- Aggregator 后端可访问（默认假设在 `http://localhost:3000`）

### 安装依赖

在仓库根目录执行一次即可（会安装 workspace 内所有 package，包括 `client`）：

```bash
pnpm install
```

### 启动前端

```bash
pnpm -C client dev --host 0.0.0.0 --port 5173
```

浏览器打开：

- `http://localhost:5173/`

### 前端如何访问后端（重要）

开发环境下，`client/vite.config.ts` 配置了代理：

- 将浏览器请求的 `/v1/*` 转发到 `http://localhost:3000/v1/*`

因此在页面“设置”里，`API Base` 推荐保持默认：

- `/v1`

> 如果你不想用代理，也可以把 `API Base` 改成 `http://localhost:3000/v1`（前端直连），并确保 Aggregator 的 CORS 允许 `http://localhost:5173`。

## 联调建议（最短路径）

1. 启动 aggregator（确认 `http://localhost:3000/v1/health` 可用）
2. 打开前端 `http://localhost:5173`
3. 设置页粘贴 `apiKey` → 点击“获取 Token”
4. 地址查询页输入一个 `0x...` 地址：
   - 先点 Balances / Activity，确认基础鉴权与返回结构
   - 用 Activity 的“加载更多”验证 `nextCursor` 翻页
5. Webhook 页：
   - 创建订阅（`targetUrl` 必须 https）
   - 点击 Test
   - 点击 “看 Deliveries” 确认 delivered / pending / dead 与错误信息

## 常见问题排查

- **401 missing_token / invalid_token**：先去“设置”页重新获取 token
- **403 insufficient_scope**：apiKey 的 scopes 不包含对应权限（如 `read:webhook` / `manage:webhook`）
- **429 rate_limit_exceeded**：触发后端限流，降低点击频率或提升 apiKey 的 rate_limit
- **Webhook 创建报 invalid_target_url**：`targetUrl` 必须是 `https://`

