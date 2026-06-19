# 付款测试环境（正规做法：独立测试环境，不动生产）

目标：在 **Creem 测试模式 + Supabase 测试库** 下，**真实唤起 Creem 付款界面、用测试卡走完付款**，并验证会员入账——而**不把生产（excalicast.cc / live）切成测试**。

> 大厂标准：production 与 staging/test **物理隔离**（不同域名、不同密钥、不同库）。绝不在生产实例上切换支付 mode。

---

## 一、为什么预览 URL 测不了付款

- Creem 只放行**已批准域名**（excalicast.cc）；Vercel 预览是随机域名 → Creem 不认。
- checkout 回跳与 webhook 用 `NEXT_PUBLIC_APP_URL`；预览环境若仍指向生产域名，回跳/回调到不了预览实例。

→ 所以要一个**固定子域名的测试部署**。

## 二、搭一个稳定测试环境（一次性）

1. **Vercel**：新建 `staging` 分支（或独立 Project）部署，绑**固定子域名**，例如 `test.excalicast.cc`。
2. **该测试部署的环境变量**（与生产分开）：
   - `NEXT_PUBLIC_APP_URL=https://test.excalicast.cc`
   - Supabase 指向**测试项目**：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_SECRET`、`DASHSCOPE_API_KEY` 等按需
3. **Creem（测试模式）后台**：
   - 把 `test.excalicast.cc` 加入放行/重定向域名
   - Webhook Endpoint → `https://test.excalicast.cc/api/creem-webhook`（拿到 `whsec_...` 测试签名密钥）
   - 建好测试用的 product（one_time / pro / max），记下 `prod_test_*` id
4. **测试库的 payment_config**：配好并激活 **creem test** 行（详见 CLAUDE.md「首次配 test 凭证」/「activate」）：

```bash
# 配 test 行凭证（指向测试库的部署域名）
curl -X POST https://test.excalicast.cc/api/admin/payment-config \
  -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{
    "provider":"creem","mode":"test",
    "apiKey":"creem_test_xxx",
    "webhookSecret":"whsec_test_xxx",
    "apiBase":"https://test-api.creem.io/v1",
    "oneTimeProductId":"prod_test_onetime",
    "proProductId":"prod_test_pro",
    "maxProductId":"prod_test_max"
  }'

# 激活 test 行（让该环境走测试 Creem）
curl -X POST https://test.excalicast.cc/api/admin/payment-config/activate \
  -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"provider":"creem","mode":"test"}'
```

## 三、跑一次端到端测试

1. 打开 `https://test.excalicast.cc`，登录（测试库账号）。
2. 点「升级 / 解锁并下载」→ **应弹出 Creem 测试付款页**（`test-api.creem.io`）。
   - 已修：付款页用「点击同步开标签 + 兜底同标签跳转」打开，不再被弹窗拦截。
3. 用 **Creem 测试卡**付款（见 Creem 文档的 test card，不扣真钱）。
4. 付完切回标签：弹窗会轮询 `/api/me/tier`；Creem 测试 webhook 命中 `test.excalicast.cc/api/creem-webhook` → 写入测试库订阅 → 档位变 max/pro（登录态也会随 `onAuthStateChange` 自动刷新）。
5. 核验：`GET https://test.excalicast.cc/api/me/tier`（带登录 cookie）应返回 `{"tier":"max",...}`。

## 四、排错

- **点了不跳付款页**：多半 test 行没配/没激活 → checkout 返回 `creem_creds_missing`（升级弹窗会显示错误）。按第 2 步配齐。
- **付完档位不变**：webhook 没到/验签失败 → 查 Creem 后台 webhook 投递日志、确认 endpoint = 测试域名、`webhookSecret` 是测试密钥；确认 `NEXT_PUBLIC_APP_URL` 与域名一致。
- **生产不受影响**：生产部署用自己的 env（live keys、生产库、`NEXT_PUBLIC_APP_URL=https://excalicast.cc`），payment_config 生产库激活 **creem live** 行——与测试环境互不干扰。
