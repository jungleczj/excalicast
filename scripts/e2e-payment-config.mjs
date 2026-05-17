#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * E2E for the payment config layer (paddle ↔ creem switch).
 *
 * 不需要真实 Creem 凭证；脚本只验证：
 *   1. 公共 /api/payment/provider 返回默认 paddle
 *   2. Admin POST 切换 provider=creem + 改价 → 持久化
 *   3. /api/payment/provider 返回新配置（不暴露 product/price ID）
 *   4. /api/checkout/one-time 在 creem 模式下：
 *        - 无 CREEM_API_KEY → 500 creem_one_time_product_id_missing 或 checkout_failed
 *        - 有 CREEM_* + 假 productId → 实际 Creem 沙盒会 4xx，但我们的路由
 *          会原样返回 502 creem_checkout_failed，证明 wiring 走通了
 *   5. /api/checkout/pro 在登录后正常切换
 *   6. Webhook 验签：错误签名 → 401，正确 HMAC → 200
 *   7. 切回 paddle，验证回滚
 *
 * 用法：
 *   BASE_URL=http://localhost:3005 node scripts/e2e-payment-config.mjs
 */

import { Buffer } from 'node:buffer';
import { createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'dev-admin-secret';
const WEBHOOK_SECRET = process.env.CREEM_WEBHOOK_SECRET ?? 'dev-creem-webhook-secret';
const TEST_EMAIL = `e2e-pay-${Date.now().toString(36)}@excalicast.test`;

// ── tiny cookie jar ────────────────────────────────────────────────────────
const jar = new Map();
function ingestSetCookie(headers) {
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const c of raw) {
    const seg = c.split(';')[0];
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (!value || /^deleted$/i.test(value)) jar.delete(name);
    else jar.set(name, value);
  }
}
function cookieHeader() {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function req(path, opts = {}) {
  const headers = new Headers(opts.headers ?? {});
  const cookie = cookieHeader();
  if (cookie) headers.set('cookie', cookie);
  const res = await fetch(new URL(path, BASE_URL), { ...opts, headers, redirect: 'manual' });
  ingestSetCookie(res.headers);
  return res;
}

// ── logging helpers ───────────────────────────────────────────────────────
let n = 0;
const step = (t) => console.log(`\n[${++n}] ${t}`);
const pass = (m) => console.log(`    ✅ ${m}`);
const info = (m) => console.log(`    ℹ  ${m}`);
async function fail(m, extra) {
  console.error(`    ❌ ${m}`);
  if (extra) console.error('       →', typeof extra === 'string' ? extra : JSON.stringify(extra));
  process.exit(1);
}
async function asJson(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

// ── flow ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Excalicast payment-config E2E — base=${BASE_URL}`);

  step('Public /api/payment/provider — baseline');
  const baseline = await asJson(await req('/api/payment/provider'));
  info(`baseline: ${JSON.stringify(baseline)}`);
  if (!baseline.provider) await fail('missing provider field', baseline);
  pass(`baseline provider=${baseline.provider} ${baseline.currency} one-time=${baseline.oneTimePriceCents}c`);

  step('Admin GET /api/admin/payment-config without secret → 403');
  const noAuth = await req('/api/admin/payment-config');
  if (noAuth.status !== 403) await fail(`expected 403, got ${noAuth.status}`, await asJson(noAuth));
  pass('correctly rejected without x-admin-secret');

  step('Admin GET with secret');
  const adminGet = await req('/api/admin/payment-config', {
    headers: { 'x-admin-secret': ADMIN_SECRET },
  });
  const adminCfg = await asJson(adminGet);
  if (!adminGet.ok) await fail('admin GET failed', adminCfg);
  pass(`admin sees: provider=${adminCfg.provider} creemPro=${adminCfg.creemProProductId ?? 'null'}`);

  step('Admin POST: switch to creem + custom prices');
  const switchRes = await req('/api/admin/payment-config', {
    method: 'POST',
    headers: { 'x-admin-secret': ADMIN_SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'creem',
      currency: 'usd',
      oneTimePriceCents: 500,
      proMonthlyPriceCents: 1200,
      creemOneTimeProductId: 'prod_test_one_time_fake',
      creemProProductId: 'prod_test_pro_fake',
    }),
  });
  const switched = await asJson(switchRes);
  if (!switchRes.ok) await fail('switch POST failed', switched);
  if (switched.provider !== 'creem') await fail('provider did not flip to creem', switched);
  if (switched.oneTimePriceCents !== 500) await fail('one-time price not updated', switched);
  pass(`flipped to creem, one-time $5, pro $12/mo`);

  step('Public provider reflects switch (without leaking product IDs)');
  const pub = await asJson(await req('/api/payment/provider'));
  if (pub.provider !== 'creem') await fail('public did not flip', pub);
  if (pub.oneTimePriceCents !== 500 || pub.proMonthlyPriceCents !== 1200) {
    await fail('prices not visible publicly', pub);
  }
  if ('creemOneTimeProductId' in pub || 'paddleOneTimePriceId' in pub) {
    await fail('public response leaks product IDs!', pub);
  }
  pass('public view correct + no IDs leaked');

  step('POST /api/checkout/one-time (creem) — anonymous, expect creem hit (likely 502 with fake key)');
  const oneTime = await req('/api/checkout/one-time', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordingId: `e2e-${randomUUID()}` }),
  });
  const oneTimeJson = await asJson(oneTime);
  info(`status=${oneTime.status} body=${JSON.stringify(oneTimeJson)}`);
  if (oneTime.status === 200) {
    if (!oneTimeJson.redirectUrl || oneTimeJson.provider !== 'creem') {
      await fail('200 OK but missing creem fields', oneTimeJson);
    }
    pass(`CREEM_API_KEY 已配 + 真实 productId → 成功拿到 redirectUrl: ${oneTimeJson.redirectUrl.slice(0, 60)}…`);
  } else if (oneTime.status === 500 && oneTimeJson.error === 'creem_one_time_product_id_missing') {
    info('product ID 在 DB 里有，但 lib 读取拿不到 — 检查 setPaymentConfig 写入是否成功');
    await fail('product_id 缺失但我们刚 set 了 prod_test_one_time_fake', oneTimeJson);
  } else if (oneTime.status === 502 && oneTimeJson.error === 'creem_checkout_failed') {
    pass('Creem 路由 wiring OK：CREEM_API_KEY 未配 / 假 productId 触发 Creem 4xx，路由返回 502 是预期');
  } else {
    await fail(`unexpected response from /api/checkout/one-time`, oneTimeJson);
  }

  step('POST /api/checkout/pro 未登录 → 401');
  const proAnon = await req('/api/checkout/pro', { method: 'POST' });
  if (proAnon.status !== 401) {
    await fail(`expected 401, got ${proAnon.status}`, await asJson(proAnon));
  }
  pass('pro checkout 正确要求登录');

  step('Login as test user');
  const login = await req('/api/dev/login-as', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL }),
  });
  const loginJson = await asJson(login);
  if (!login.ok || !loginJson.ok) await fail('login-as failed', loginJson);
  pass(`logged in as ${loginJson.email}`);

  step('POST /api/checkout/pro 已登录 + creem (期望 502 或 200)');
  const proAuth = await req('/api/checkout/pro', { method: 'POST' });
  const proAuthJson = await asJson(proAuth);
  info(`status=${proAuth.status} body=${JSON.stringify(proAuthJson)}`);
  if (proAuth.status === 200 && proAuthJson.provider === 'creem' && proAuthJson.redirectUrl) {
    pass(`Creem checkout URL 成功生成: ${proAuthJson.redirectUrl.slice(0, 60)}…`);
  } else if (proAuth.status === 502 && proAuthJson.error === 'creem_checkout_failed') {
    pass('Creem 路由 wiring OK：缺真实 KEY/productId → 502 是预期');
  } else {
    await fail('unexpected /api/checkout/pro response', proAuthJson);
  }

  step('Webhook with bad signature → 401');
  const badSig = await req('/api/creem-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'creem-signature': 'deadbeef' },
    body: JSON.stringify({ eventType: 'checkout.completed', object: {} }),
  });
  if (badSig.status !== 401) {
    await fail(`expected 401 invalid_signature, got ${badSig.status}`, await asJson(badSig));
  }
  pass('bad signature rejected');

  step('Webhook with valid HMAC + one-time payload → 200 + recording marked paid');
  const recordingForWebhook = `e2e-webhook-${randomUUID()}`;
  const payload = JSON.stringify({
    eventType: 'checkout.completed',
    object: {
      id: 'co_test_123',
      metadata: { kind: 'one_time', recordingId: recordingForWebhook },
      order: { id: 'ord_test_456', amount: 500, currency: 'usd' },
    },
  });
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(payload, 'utf8').digest('hex');
  const okHook = await req('/api/creem-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'creem-signature': sig },
    body: payload,
  });
  const okHookJson = await asJson(okHook);
  if (!okHook.ok) await fail(`webhook failed: ${okHook.status}`, okHookJson);
  if (okHookJson.kind !== 'one_time') await fail('webhook did not classify as one_time', okHookJson);
  pass(`webhook accepted: ${JSON.stringify(okHookJson)}`);

  step('Verify /api/is-paid sees the webhook-marked recording');
  const paidCheck = await req('/api/is-paid', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordingId: recordingForWebhook }),
  });
  const paidJson = await asJson(paidCheck);
  if (!paidJson.paid) await fail('recording not marked paid after webhook', paidJson);
  pass(`recording ${recordingForWebhook.slice(0, 18)}… 已确认 paid=true`);

  step('Webhook with subscription.active payload → 200 + tier=pro');
  const subUserId = loginJson.userId;
  const subPayload = JSON.stringify({
    eventType: 'subscription.active',
    object: {
      id: 'sub_test_789',
      metadata: { userId: subUserId },
      customer_id: 'cust_test_abc',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    },
  });
  const subSig = createHmac('sha256', WEBHOOK_SECRET).update(subPayload, 'utf8').digest('hex');
  const subHook = await req('/api/creem-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'creem-signature': subSig },
    body: subPayload,
  });
  const subHookJson = await asJson(subHook);
  if (!subHook.ok) await fail(`sub webhook failed: ${subHook.status}`, subHookJson);
  if (subHookJson.kind !== 'subscription') await fail('not classified as subscription', subHookJson);
  pass(`sub webhook OK: status=${subHookJson.status}`);

  step('Verify /api/me/tier shows pro');
  const tierAfterSub = await asJson(await req('/api/me/tier'));
  if (tierAfterSub.tier !== 'pro' || tierAfterSub.status !== 'active') {
    await fail('user not flipped to active Pro via Creem webhook', tierAfterSub);
  }
  pass(`tier=${tierAfterSub.tier} status=${tierAfterSub.status} via Creem webhook`);

  step('Switch back to paddle (cleanup) — admin POST');
  const backRes = await req('/api/admin/payment-config', {
    method: 'POST',
    headers: { 'x-admin-secret': ADMIN_SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'paddle',
      oneTimePriceCents: 300,
      proMonthlyPriceCents: 900,
    }),
  });
  const backJson = await asJson(backRes);
  if (!backRes.ok || backJson.provider !== 'paddle') await fail('rollback failed', backJson);
  pass(`rolled back to paddle, one-time $3 / pro $9`);

  step('After rollback: /api/checkout/pro returns paddle config');
  const proAfter = await asJson(await req('/api/checkout/pro', { method: 'POST' }));
  if (proAfter.provider !== 'paddle' || !proAfter.priceId) {
    await fail('did not return paddle config after rollback', proAfter);
  }
  pass(`paddle path OK: priceId=${proAfter.priceId}`);

  console.log('\n🎉 payment-config E2E passed — provider switching, gating, webhook, admin config 均验证通过');
}

main().catch(async (err) => {
  await fail(`unhandled: ${err?.message ?? err}`, err?.stack ?? '');
});
