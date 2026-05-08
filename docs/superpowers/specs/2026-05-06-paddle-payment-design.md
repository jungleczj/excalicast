# Paddle 单次导出支付集成设计

**日期**：2026-05-06
**目标**：用 Paddle Overlay Checkout 替换现有 Creem 占位实现，让用户付费 $3 解锁单条录制的无水印 MP4 导出。

---

## 1. 背景

当前代码里有一套基于 Creem 的支付占位实现（`src/lib/creem.ts`、`/api/checkout`、`/api/creem-webhook`、SQLite 表 `paid_recordings.creem_session_id`）。Creem 没有真实接通生产支付，且产品不再使用 Creem。

现在切换到 Paddle，并按 CLAUDE.md 的设计原则保持单次购买**完全匿名**（不需要建账号）。

## 2. 目标 / 非目标

### 目标

- 替换 Creem 为 Paddle，作为唯一支付提供方。
- 使用 Paddle **Overlay Checkout**（页面内弹层），不跳转外部域名，体验比原 Creem 跳转更顺。
- 保留单条录制粒度的"已付费"判定（`paid_recordings` 表），导出 MP4 时按需校验。
- 保留匿名购买体验：Paddle 自己收 email 用于发收据，应用本身不建账号。
- 提供本地调试方案，覆盖快速 UI 迭代和完整 e2e 验证两种场景。
- **Sandbox 优先**：本次先把 Paddle Sandbox 跑通，部署 production 时仅切环境变量。

### 非目标

- **不解决** Vercel + SQLite 持久化问题（`/tmp` 路径冷启动丢失）。这是已知遗留问题，独立 task 处理。
- **不重构**导出管线、付费状态查询逻辑。`/api/is-paid`、`exportPipeline.ts`、`ExportPanel.tsx` 的"读 paid → 切换水印"逻辑保持不变。
- **不引入** Paddle 订阅、退款流程、税务报表等功能。仅一次性 $3。
- **不做** 多种支付方式并存或抽象层。

## 3. 架构概览

### 3.1 整体流程

```
用户点 "解锁并下载 $3"
  ↓
PaywallModal 调用 paddleClient.openCheckout(recordingId)
  ↓
Paddle.js Overlay 弹出（用户填邮箱+卡号）
  ↓
Paddle 后端创建 transaction → 收款成功
  ↓
两件事并行：
  ├─ A. Overlay 触发 'checkout.completed' 事件
  │     → 前端关闭 overlay
  │     → 启动轮询 /api/is-paid（每秒一次，最多 10 次）
  │
  └─ B. Paddle 后端 → POST /api/paddle-webhook
        → HMAC-SHA256 验签
        → markRecordingPaid 写 paid_recordings 表
  ↓
轮询命中 paid=true → setPaid(true) → ExportPanel 切到无水印模式
```

### 3.2 双重确认机制

**只信 webhook，不信客户端**：webhook 是付费状态写入 DB 的唯一路径；客户端 `checkout.completed` 事件**只用作触发轮询的信号**，不直接写 DB。这样客户端无法伪造支付。

如果 webhook 比客户端事件晚到（常见 1-3 秒延迟），轮询会等到 webhook 写入后再切换 UI。如果 10 秒内仍未命中，UI 提示 "支付确认中，稍后刷新页面"，留出兜底。

## 4. 文件改动

### 4.1 新增（4 个）

| 文件 | 作用 |
|---|---|
| `src/lib/paddle.ts` | 服务端工具：webhook 验签（HMAC-SHA256，Paddle 格式 `ts=...;h1=...`）、parse `transaction.completed` payload、提取 `customData.recordingId` |
| `src/app/api/paddle-webhook/route.ts` | 接收 Paddle webhook，验签后写 DB |
| `src/components/providers/PaddleProvider.tsx` | 客户端 Provider，初始化 `@paddle/paddle-js` 并通过 React Context 暴露 `paddle` 实例 |
| `src/services/paddleClient.ts` | 客户端 helper：`openCheckout(recordingId, onComplete)`，封装 `paddle.Checkout.open()` 和 `eventCallback` 监听 |

### 4.2 修改（5 个）

| 文件 | 改动 |
|---|---|
| `src/components/PaywallModal.tsx` | 不再 redirect。`handleUnlock` 改为调 `openCheckout()`；overlay 关闭后启动轮询（直到 `isPaid=true` 或超时）；UI 文案 "正在跳转 Creem…" → "正在打开 Paddle…"；卖点列表里 "Creem 安全支付" → "Paddle 安全支付（信用卡 / Apple Pay / Google Pay）"；新增 dev-only 链接 "[dev] 跳过 Paddle，直接标记已付款"（仅 `NEXT_PUBLIC_DEV_MODE=true` 时显示） |
| `src/components/ExportPanel.tsx` | 删除 URL 里 `?paid=1` 的 query param 解析（Overlay 模式不会跳转，没有这个 param）。其余刷新逻辑保留 |
| `src/app/layout.tsx` | 在 `<body>` 内层包裹 `<PaddleProvider>` |
| `src/lib/db.ts` | `ALTER TABLE paid_recordings RENAME COLUMN creem_session_id TO paddle_transaction_id`；`markRecordingPaid` 参数 `creemSessionId` 改名为 `paddleTransactionId`；`paid_recordings` 表迁移用 idempotent 检查（`PRAGMA table_info` 后决定是否执行 RENAME），保证多次启动不报错 |
| `src/types/recording.ts` | `PaidRecordingRow.creem_session_id` 改名 `paddle_transaction_id` |

### 4.3 删除（3 个）

- `src/lib/creem.ts`
- `src/app/api/creem-webhook/route.ts`
- `src/app/api/checkout/route.ts`（Overlay 模式不需要服务端创建 checkout session）

### 4.4 保留（2 个，无改动）

- `src/app/api/is-paid/route.ts`（与支付商无关）
- `src/app/api/dev/simulate-payment/route.ts`（本地 dev mock）

## 5. 环境变量

### 5.1 新增

| 变量 | Sandbox 值 | Production 值 | 暴露给客户端 |
|---|---|---|---|
| `NEXT_PUBLIC_PADDLE_ENV` | `sandbox` | `production` | 是 |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | `test_b111bb96f343e11e6274baa6ff8` | 切到 production 账号后重新生成 | 是 |
| `NEXT_PUBLIC_PADDLE_PRICE_ID` | `pri_01kqxh5px07a1ezc42xpta118s` | 切到 production 账号后重新生成 | 是 |
| `PADDLE_API_KEY` | `<PADDLE_SANDBOX_API_KEY>` | 切到 production 账号后重新生成 | 否 |
| `PADDLE_WEBHOOK_SECRET` | `<PADDLE_SANDBOX_WEBHOOK_SECRET>` | （production 部署后建 destination 后获取） | 否 |
| `NEXT_PUBLIC_DEV_MODE` | `true` | 不设 | 是 |
| `DEV_MODE` | `true` | 不设 | 否 |

### 5.2 删除

`CREEM_API_KEY`、`CREEM_PRODUCT_ID`、`CREEM_WEBHOOK_SECRET`、`SINGLE_PURCHASE_PRICE_CENTS`、`SINGLE_PURCHASE_CURRENCY`（价格走 Paddle 后台 Price 配置，不再由 env 控制）。

## 6. 关键实现细节

### 6.1 Paddle webhook 验签

Paddle 与 Creem/Stripe 不同：

- Header 名：`Paddle-Signature`
- Header 格式：`ts=1700000000;h1=abc...`
- HMAC 输入：`${ts}:${rawBody}`（**不是**裸 body）
- 算法：HMAC-SHA256
- secret：`PADDLE_WEBHOOK_SECRET`，对应 Paddle Dashboard → Notifications → destination 的 secret key

`lib/paddle.ts` 提供：

```ts
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean
export function parseTransactionCompleted(payload: unknown): { recordingId: string; transactionId: string; amountCents: number; currency: string } | null
```

### 6.2 Paddle.js 初始化

```tsx
// PaddleProvider.tsx
'use client';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';

const ctx = createContext<Paddle | null>(null);

export function PaddleProvider({ children }: { children: ReactNode }) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  useEffect(() => {
    initializePaddle({
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production',
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
    }).then((p) => setPaddle(p ?? null));
  }, []);
  return <ctx.Provider value={paddle}>{children}</ctx.Provider>;
}

export function usePaddle() { return useContext(ctx); }
```

### 6.3 打开 checkout

```ts
// services/paddleClient.ts
export function openCheckout(paddle: Paddle, recordingId: string, onComplete: () => void) {
  paddle.Checkout.open({
    items: [{ priceId: process.env.NEXT_PUBLIC_PADDLE_PRICE_ID!, quantity: 1 }],
    customData: { recordingId },
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      successUrl: undefined,  // 不需要，Overlay 模式靠事件回调
    },
  });
  // 事件订阅在 PaddleProvider 顶层做（initializePaddle 的 eventCallback 参数）
  // 或者在这里给 paddle.Update 注入临时回调，看 SDK 支持
}
```

`checkout.completed` 事件回调里：关闭 overlay（`paddle.Checkout.close()`）+ 通知调用方（`onComplete`）+ 调用方启动 `/api/is-paid` 轮询。

### 6.4 轮询逻辑

```ts
// PaywallModal 内部（伪代码）
async function pollUntilPaid(recordingId: string, maxAttempts = 10, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    if (await isPaid(recordingId)) return true;
  }
  return false;
}
```

超时则 UI 显示 "支付确认中，请稍后刷新页面"（不报错，因为 webhook 大概率最终会到）。

### 6.5 DB schema 迁移

idempotent 写法，启动时检查列名：

```ts
const cols = db.prepare("PRAGMA table_info(paid_recordings)").all() as { name: string }[];
const hasOldCol = cols.some((c) => c.name === 'creem_session_id');
const hasNewCol = cols.some((c) => c.name === 'paddle_transaction_id');
if (hasOldCol && !hasNewCol) {
  db.exec('ALTER TABLE paid_recordings RENAME COLUMN creem_session_id TO paddle_transaction_id');
}
```

## 7. 本地调试方案

### 7.1 层 1：Dev Mock（覆盖 95% 开发场景）

不真正触发 Paddle，只验证 UI/DB 上的"付费状态切换"路径。

**配置**：`.env.local` 加：

```
DEV_MODE=true
NEXT_PUBLIC_DEV_MODE=true
```

**用法**：

1. `npm run dev`
2. 完成一次录制，点击 "解锁并下载 $3"
3. 在 PaywallModal 里点 dev-only 的小灰链接 "[dev] 跳过 Paddle，直接标记已付款"
4. 调用 `/api/dev/simulate-payment` → 写 `paid_recordings` 表 → modal 关闭 → ExportPanel 切到无水印

**不需要任何 Paddle 配置**就能跑这条路径。

### 7.2 层 2：Sandbox + cloudflared（部署前 e2e 验证）

测真正的 Paddle Overlay + webhook 验签 + 整条链路。

**前置（一次性）**：

1. （已完成）Sandbox 账号 https://sandbox-vendors.paddle.com
2. （已完成）Sandbox Product 和 Price，拿到 `pri_01kqxh5px07a1ezc42xpta118s`
3. （已完成）Sandbox API key 和 client token
4. 起 cloudflared 隧道：`cloudflared tunnel --url http://localhost:3001`，拿到形如 `https://xxx.trycloudflare.com` 的 URL
5. （已完成）在 Sandbox Dashboard → Developer Tools → Notifications 已建 destination，事件勾选 `transaction.completed`，secret 已记录在 `PADDLE_WEBHOOK_SECRET`
6. cloudflared URL 变化时，回 Sandbox Dashboard 更新 destination URL 即可（secret 不变）

**测试**：

- Paddle Sandbox 测试卡：`4000 0566 5566 5556`，未来日期，任意 CVC，邮编 `10001`
- 验证 `paid_recordings` 表里写入了 `paddle_transaction_id`
- 验证 ExportPanel 自动切换到无水印模式

**注意**：cloudflared 隧道每次重启 URL 会变，需要更新 destination。如果嫌麻烦可以用付费 named tunnel；但本次先不引入这个复杂度。

### 7.3 文档落地

新增 `docs/paddle-local-dev.md`，把 7.1 / 7.2 的步骤写成 runbook，方便协作者照做。

## 8. 部署流程

1. 在 sandbox 完整跑通 7.2 全流程
2. 在 Paddle production 账号下重建 Product / Price / Notification destination
3. 在 Vercel Project → Environment Variables 配置 production 版的 5 个变量（不要勾 `DEV_MODE` 系列）
4. Paddle production destination URL 填 `https://excalicast.vercel.app/api/paddle-webhook`
5. 部署 → 真卡测试一次 → 退款（Paddle 后台）

## 9. 安全 / 风险

| 风险 | 缓解 |
|---|---|
| 客户端伪造 `checkout.completed` 事件骗过前端 | 前端事件只触发轮询，不直接信任；写 DB 必须经 webhook |
| 重放攻击：拿到旧 webhook payload 重发 | Paddle 的 timestamp 验证（HMAC 输入含 ts），过期请求签名不一致；额外可在 `markRecordingPaid` 用 `ON CONFLICT DO NOTHING` 避免重复写入 |
| webhook secret 泄露 | 仅服务端 env，不暴露给客户端；本地用 `.env.local` 不进 git |
| Vercel `/tmp` SQLite 数据丢失 | **本次不修复**。已知遗留问题，单独 task 处理 |
| `customData` 大小 | Paddle 限制 8KB，我们只塞 `{recordingId}`，远低于上限 |

## 10. 测试清单

- [ ] dev mode 下 simulate-payment 仍能正常解锁（向后兼容）
- [ ] sandbox 模式下 Overlay 能正常弹出
- [ ] sandbox 测试卡完成支付后，前端轮询 1-3 秒内拿到 `paid=true`
- [ ] webhook 验签：正确签名通过、错误签名拒绝（401）
- [ ] webhook 重复送达：DB 不会写入两条
- [ ] DB schema 迁移：从有旧列的 db 启动 → 自动 rename；从干净 db 启动 → 直接建新列；多次启动 → 不报错
- [ ] 删除录制后再付款：webhook 仍能写入（recording_id 不外键约束 recording 实体）
- [ ] PaywallModal 在 `DEV_MODE=false` 时**不显示** dev 链接（防止生产泄露）

## 11. 后续工作（不在本次 scope）

- Vercel SQLite → Postgres / Turso 迁移（解决付费数据冷启动丢失）
- Paddle 退款 webhook（`transaction.refunded`）→ 撤销付费状态
- 多币种 / 区域定价
- 已购买的录制聚合视图（用户找回历史购买）

## 12. 回滚策略

如果 Paddle 集成上线后有严重问题：

1. 切回 Vercel env：把 `NEXT_PUBLIC_DEV_MODE=true` 加到生产（**只是临时让用户能用 dev mock**——⚠️ 这是漏洞，仅作紧急止血）
2. 或者整体 git revert 这次 PR，回到 Creem 占位（用户拿不到无水印导出但不会报错）

合理的真实回滚是 git revert + redeploy；不接受 1 这种带漏洞的紧急方案除非完全断了支付。
