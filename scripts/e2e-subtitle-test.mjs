#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * E2E test for the Pro subtitle pipeline (dev mode, no Paddle, no DashScope).
 *
 * Walks the full backend chain:
 *   1. POST /api/dev/login-as { email }  → 拿到 Supabase 会话 cookie
 *   2. GET  /api/me/tier                 → 应当 logged_in=true, tier=free
 *   3. POST /api/dev/grant-pro           → 直接发 Pro，绕过 Paddle
 *   4. GET  /api/me/tier                 → tier=pro, status=active
 *   5. POST /api/asr/submit              → 上传一段假音频；命中 dev fallback
 *                                         返回 { mock: true, jobId }
 *   6. GET  /api/asr/status?jobId=...    → status=done, srt 包含示例字幕
 *
 * 用法：
 *   node scripts/e2e-subtitle-test.mjs              # 默认 BASE_URL=http://localhost:3001
 *   BASE_URL=http://localhost:3005 node scripts/e2e-subtitle-test.mjs
 *
 * 前置：先把 dev server 跑起来，且 .env.local 的 DEV_MODE=true。
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import process from 'node:process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';
const TEST_EMAIL = process.env.E2E_EMAIL ?? `e2e-${Date.now().toString(36)}@excalicast.test`;

// ── tiny cookie jar ────────────────────────────────────────────────────────
const jar = new Map(); // name → value

function ingestSetCookie(headers) {
  // Node 19.7+ has getSetCookie(); older Node has raw 'set-cookie' as comma-joined string.
  const raw = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.raw?.()['set-cookie'] ?? []);
  for (const c of raw) {
    const firstSeg = c.split(';')[0];
    const eq = firstSeg.indexOf('=');
    if (eq <= 0) continue;
    const name = firstSeg.slice(0, eq).trim();
    const value = firstSeg.slice(eq + 1).trim();
    if (!name) continue;
    if (value === '' || /^deleted$/i.test(value)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function cookieHeader() {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function req(path, opts = {}) {
  const url = new URL(path, BASE_URL).toString();
  const headers = new Headers(opts.headers ?? {});
  const cookie = cookieHeader();
  if (cookie) headers.set('cookie', cookie);
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  ingestSetCookie(res.headers);
  return res;
}

// ── pretty step logging ───────────────────────────────────────────────────
let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}`);
}
function pass(msg) { console.log(`    ✅ ${msg}`); }
function info(msg) { console.log(`    ℹ  ${msg}`); }
async function fail(msg, extra) {
  console.error(`    ❌ ${msg}`);
  if (extra) console.error('       →', extra);
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────
async function jsonOrText(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function fakeAudio() {
  // Arbitrary bytes — submit route doesn't validate format, and the
  // dev/localhost fallback returns mock SRT without reaching DashScope.
  const header = Buffer.from('1a45dfa3', 'hex'); // EBML magic bytes
  const filler = Buffer.alloc(1024, 0x42);
  return Buffer.concat([header, filler]);
}

// ── flow ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Excalicast subtitle E2E — base=${BASE_URL}  email=${TEST_EMAIL}`);

  step('Server health');
  const ping = await req('/api/me/tier');
  if (!ping.ok) await fail(`GET /api/me/tier → HTTP ${ping.status}`, await ping.text());
  const baseline = await jsonOrText(ping);
  pass(`/api/me/tier responding: ${JSON.stringify(baseline)}`);

  step('Dev login (bypass magic link)');
  const login = await req('/api/dev/login-as', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL }),
  });
  const loginJson = await jsonOrText(login);
  if (!login.ok) await fail(`login-as HTTP ${login.status}`, JSON.stringify(loginJson));
  if (!loginJson.ok) await fail('login-as did not return ok=true', JSON.stringify(loginJson));
  const cookieCount = jar.size;
  if (cookieCount === 0) await fail('no auth cookies were set by login-as');
  pass(`logged in as ${loginJson.email} (userId=${loginJson.userId}), ${cookieCount} cookies set`);

  step('Verify auth landed: /api/me/tier should show loggedIn=true, tier=free');
  const tier1 = await req('/api/me/tier');
  const t1 = await jsonOrText(tier1);
  if (!tier1.ok) await fail(`/api/me/tier HTTP ${tier1.status}`, JSON.stringify(t1));
  if (t1.loggedIn !== true) await fail('expected loggedIn=true after login-as', JSON.stringify(t1));
  if (t1.tier !== 'free') await fail(`expected tier=free, got ${t1.tier}`, JSON.stringify(t1));
  pass(`auth OK: ${JSON.stringify(t1)}`);

  step('Reject subtitle submit while free (gate works)');
  {
    const form = new FormData();
    form.append('recordingId', `e2e-free-${randomUUID()}`);
    form.append('audio', new Blob([fakeAudio()], { type: 'audio/webm' }), 'free.webm');
    const denied = await req('/api/asr/submit', { method: 'POST', body: form });
    if (denied.status !== 403) {
      const j = await jsonOrText(denied);
      await fail(`free user should get 403 from /api/asr/submit, got ${denied.status}`, JSON.stringify(j));
    }
    pass('free user correctly blocked with 403');
  }

  step('Dev grant Pro (bypass Paddle)');
  const grant = await req('/api/dev/grant-pro', { method: 'POST' });
  const grantJson = await jsonOrText(grant);
  if (!grant.ok) await fail(`grant-pro HTTP ${grant.status}`, JSON.stringify(grantJson));
  if (grantJson.tier !== 'pro' || grantJson.status !== 'active') {
    await fail('grant-pro returned wrong shape', JSON.stringify(grantJson));
  }
  pass(`Pro granted: tier=${grantJson.tier} status=${grantJson.status}`);

  step('Verify tier flipped: /api/me/tier should show tier=pro');
  const tier2 = await req('/api/me/tier');
  const t2 = await jsonOrText(tier2);
  if (t2.tier !== 'pro' || t2.status !== 'active') {
    await fail('expected tier=pro after grant', JSON.stringify(t2));
  }
  pass(`tier flipped: ${JSON.stringify(t2)}`);

  step('Submit subtitle job (dev/localhost → mock SRT path)');
  const recordingId = `e2e-${randomUUID()}`;
  const form = new FormData();
  form.append('recordingId', recordingId);
  form.append('audio', new Blob([fakeAudio()], { type: 'audio/webm' }), `${recordingId}.webm`);
  const submit = await req('/api/asr/submit', { method: 'POST', body: form });
  const submitJson = await jsonOrText(submit);
  if (!submit.ok) await fail(`submit HTTP ${submit.status}`, JSON.stringify(submitJson));
  if (!submitJson.jobId) await fail('submit missing jobId', JSON.stringify(submitJson));
  if (submitJson.mock !== true) {
    info(`submit did NOT mark mock:true → DashScope path will be used`);
    info(`reason hint from server: ${submitJson.reason ?? '(none)'}`);
  } else {
    pass(`mock job created: jobId=${submitJson.jobId} reason=${submitJson.reason}`);
  }

  step('Poll /api/asr/status');
  const jobId = submitJson.jobId;
  let final = null;
  for (let i = 0; i < 30; i++) {
    const s = await req(`/api/asr/status?jobId=${encodeURIComponent(jobId)}`);
    const j = await jsonOrText(s);
    if (!s.ok) await fail(`status HTTP ${s.status}`, JSON.stringify(j));
    info(`poll #${i + 1}: ${j.status}`);
    if (j.status === 'done' || j.status === 'failed') {
      final = j;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!final) await fail('status never reached terminal state within 30s');
  if (final.status !== 'done') await fail(`expected status=done, got ${final.status}`, JSON.stringify(final));
  if (!final.srt || final.srt.length < 10) await fail('SRT is missing/empty', JSON.stringify(final));
  pass(`SRT received (${final.srt.length} chars)`);

  console.log('\n──── SRT preview (first 400 chars) ────');
  console.log(final.srt.slice(0, 400));
  console.log('──── END SRT ────');

  console.log('\n🎉 All 7 steps passed. Subtitle backend chain is healthy.');
  console.log(`   Test user (lingers in Supabase): ${TEST_EMAIL}`);
}

main().catch(async (err) => {
  await fail(`unhandled exception: ${err?.message ?? err}`, err?.stack ?? '');
});
