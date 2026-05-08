# Paddle 本地调试

两层方案：层 1 快速 mock 用于日常开发，层 2 sandbox + cloudflared 用于部署前 e2e 验证。

## 层 1 — Dev Mock（不需要任何 Paddle 配置）

`.env.local`：

```
DEV_MODE=true
NEXT_PUBLIC_DEV_MODE=true
```

启动：

```
npm run dev
```

录一条 → 点 "解锁并下载 $3" → 在 Paywall 弹层底部点 "[dev] 跳过 Paddle，直接标记已付款" → 切到无水印。

## 层 2 — Sandbox + Cloudflared（完整 Paddle 链路）

### 一次性准备（已完成）

- Sandbox 账号：https://sandbox-vendors.paddle.com
- 一次性 Price：`pri_01kqxh5px07a1ezc42xpta118s`（USD $3）
- API key：`<PADDLE_SANDBOX_API_KEY>`
- Client token：`test_b111bb96f343e11e6274baa6ff8`
- Webhook secret：`<PADDLE_SANDBOX_WEBHOOK_SECRET>`

### 每次开发启动

Terminal 1：

```
npm run dev
```

Terminal 2：

```
cloudflared tunnel --url http://localhost:3001
```

复制输出的 `https://xxx.trycloudflare.com` URL，去 Paddle Sandbox Dashboard → Developer Tools → Notifications → 编辑 destination，把 URL 改为 `https://xxx.trycloudflare.com/api/paddle-webhook`（事件勾选 `transaction.completed`）。secret 不变。

### `.env.local`（sandbox）

```
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_b111bb96f343e11e6274baa6ff8
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_01kqxh5px07a1ezc42xpta118s
PADDLE_WEBHOOK_SECRET=<PADDLE_SANDBOX_WEBHOOK_SECRET>
PADDLE_API_KEY=<PADDLE_SANDBOX_API_KEY>
DEV_MODE=true
NEXT_PUBLIC_DEV_MODE=true
```

### 测试卡

- 卡号：`4000 0566 5566 5556`
- 过期：任意未来日期
- CVC：任意
- 邮编：`10001`

### 验证

录一条 → "立即解锁 · $3" → Paddle Overlay 弹出 → 用测试卡支付 → 1-3 秒内 ExportPanel 自动切换到无水印模式。

### 排查

- Overlay 不弹出：浏览器控制台看 `[PaddleProvider] initializePaddle failed`，多半是 token 错或环境变量没暴露给客户端（必须 `NEXT_PUBLIC_` 前缀）
- 支付完成但 UI 不切换：服务端日志看是否收到 webhook；签名校验失败（401）说明 secret 错或 cloudflared URL 没更新到 Paddle destination
- 多次启动 cloudflared URL 会变，每次都要更新 Paddle destination

## 部署 production

把 `.env.local` 的 sandbox 值换成 production 账号下重新创建的（Paddle production 是独立账号），写到 Vercel Project → Environment Variables。**生产不要设 `DEV_MODE` / `NEXT_PUBLIC_DEV_MODE`**，否则 dev mock 链接会显示给真实用户。

Production webhook URL：`https://excalicast.vercel.app/api/paddle-webhook`
