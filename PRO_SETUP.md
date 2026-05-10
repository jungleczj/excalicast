# Pro 会员功能 — 部署 / 测试 Runbook

本文档说明如何把 Pro 订阅、千问 ASR 字幕、时长解锁等功能在 Paddle Sandbox + 阿里千问环境下跑通。

## 1. 先决条件

| 服务 | 用途 | 申请 |
|---|---|---|
| Paddle Sandbox | Pro 订阅产品 + 一次性购买 | https://sandbox-vendors.paddle.com |
| 阿里 DashScope | 千问 ASR（字幕） | https://dashscope.console.aliyun.com/apiKey |
| ngrok / Cloudflare Tunnel（仅本地） | 让 Paddle webhook + DashScope 能访问 localhost | https://ngrok.com |

## 2. Paddle Sandbox 设置

1. 进 Paddle Sandbox 后台 → Catalog → Products → Create
   - 名称：`Excalicast Pro`
   - 类型：选 Recurring
   - Billing period：Monthly
   - 创建一个 Price（如 $9 USD/month），记下 price id `pri_01xxxx`
2. Notifications → Create endpoint → 填写 `https://<your-ngrok-domain>/api/paddle-webhook`
   - 订阅事件：`subscription.activated`, `subscription.updated`, `subscription.cancelled`, `subscription.paused`, `subscription.resumed`, `subscription.past_due`
   - 加上原有 `transaction.completed`（去水印的一次性购买）
   - 复制 secret key
3. Developer Tools → Authentication → Client tokens：复制 client token

## 3. 配置环境变量

复制 `.env.local.example` → `.env.local`，填入：

```bash
NEXT_PUBLIC_PADDLE_ENV=sandbox
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=test_xxxxxx        # 来自 step 2.3
NEXT_PUBLIC_PADDLE_PRICE_ID=pri_xxx                # 一次性 $3 去水印
NEXT_PUBLIC_PADDLE_PRO_PRICE_ID=pri_xxx            # Pro 订阅，来自 step 2.1
PADDLE_WEBHOOK_SECRET=ntfset_xxxxxx                # 来自 step 2.2

NEXT_PUBLIC_APP_URL=https://<ngrok-or-deploy-url>  # 本地必须用 ngrok，DashScope 不能回调 localhost
DEV_MODE=true                                      # 自动开启 dev 简化（mock SRT 等）
NEXT_PUBLIC_DEV_MODE=true

AUTH_SECRET=$(openssl rand -base64 32)             # NextAuth secret
AUTH_RESEND_KEY=re_xxx                             # 邮箱登录（可选，dev 模式会 console.log magic link）
AUTH_EMAIL_FROM=login@yourdomain.com

DASHSCOPE_API_KEY=sk-xxxxxxxxxxxx                  # 来自阿里 DashScope，未设置则自动 fallback 到 mock SRT
```

## 4. E2E 测试步骤

### 4.1 启动本地 + ngrok

```bash
# 终端 A：开 dev server
npm run dev      # 监听 :3001

# 终端 B：暴露公网（让 Paddle webhook 和 DashScope 都能访问）
ngrok http 3001
# 拿到 https://abc.ngrok.io，更新 .env.local 的 NEXT_PUBLIC_APP_URL，重启 dev
```

### 4.2 Pro 订阅流程

1. 浏览器打开 `https://abc.ngrok.io/app`
2. 右上角 → 「升级 Pro」 → 弹出 ProUpgradeModal
3. 未登录 → 点击会跳到登录 → 用 magic link 登录
4. 登录后再点「升级 Pro」 → Paddle Overlay Checkout 打开
5. 用 Paddle Sandbox 测试卡号支付（如 `4242 4242 4242 4242` / 任意未来日期 / 任意 CVV）
6. 支付成功 → Paddle 推送 `subscription.activated` → /api/paddle-webhook → upsertSubscription
7. 客户端 ProUpgradeModal 轮询 `/api/me/tier` → 检测到 `tier=pro` → 关闭 Modal，UI 显示 Pro 标签

### 4.3 时长解锁（30min → unlimited）

1. 用 free 账号开始录制 → 录制条计时
2. 25min 时顶部出现警告 banner（不打断录制）
3. 30min 时自动停止 + 弹 Pro 升级 Modal
4. 升级 Pro 后再次录制，无 25/30min 警告

### 4.4 无水印导出

1. 用 free 账号录制完毕 → /export/[id] → 选择「无水印导出」 → 弹 PaywallModal（$3 单次 OR 升级 Pro）
2. 用 Pro 账号 → 「无水印导出」直接可用，无需付费

### 4.5 千问字幕

1. Pro 用户 → 进 /export/[id] → 「AI 字幕（千问 ASR）」 → 「开始生成」
2. 客户端把音频 POST 到 /api/asr/submit
3. 服务端把音频存 /tmp，标记 job pending，返回 jobId
4. 客户端轮询 /api/asr/status?jobId
5. 第一次轮询时服务端 submit DashScope task（用 ngrok URL 给 DashScope 抓音频）
6. 后续轮询每次 poll 一次 DashScope，DashScope 完成后保存 SRT
7. UI 显示 SRT 预览 + 下载按钮

### 4.6 Mock 路径（无需 DashScope key 也能跑通 UI）

- 不设置 `DASHSCOPE_API_KEY`，或 NEXT_PUBLIC_APP_URL 是 localhost → /api/asr/submit 直接返回 mock SRT
- UI 全流程可演示，但内容是固定示例文本

## 5. 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| ProUpgradeModal 报 "NEXT_PUBLIC_PADDLE_PRO_PRICE_ID is not set" | 没在 .env.local 填 Pro priceId | 见 step 2.1 |
| Paddle 支付完成但 tier 不变 | webhook 没到 / 没验签通过 | 检查 Paddle dashboard webhook 日志；DEV_MODE=true 时跳过验签 |
| 字幕始终是 "Mock 字幕" | DashScope key 未设 OR NEXT_PUBLIC_APP_URL 是 localhost | 设 DASHSCOPE_API_KEY + 用 ngrok 公网 URL |
| 字幕 task FAILED | DashScope 无法访问 audio URL | 确认 ngrok 在跑且 NEXT_PUBLIC_APP_URL 指向它 |
| Pro 取消后立即变 free | 是设计行为不？ | 非：cancelled 但 currentPeriodEnd 未到期 → 仍返回 tier=pro（见 /api/me/tier 逻辑）|

## 6. 安全检查清单

- ✅ `DASHSCOPE_API_KEY` 不带 `NEXT_PUBLIC_` 前缀，仅服务端可见
- ✅ `PADDLE_WEBHOOK_SECRET` 同上
- ✅ /api/asr/submit 校验登录 + Pro tier
- ✅ /api/asr/status 校验 jobId 归属当前用户
- ✅ /api/asr/audio/[token] 用随机 32-hex 一次性 token，作业完成后删除文件
- ✅ /api/me/tier 不接受 query 中的 userId 输入（只信 session）
- ✅ Paddle webhook 验签：HMAC-SHA256(`ts:rawBody`)，5min 时间戳容忍

## 7. 不在本期范围

- ❌ Max tier（讲义生成 + 分享链接）
- ❌ 云端备份的 IndexedDB ↔ S3 双向同步
- ❌ Subscription 取消 / 升级 / 计费门户 UI（用 Paddle Customer Portal）
