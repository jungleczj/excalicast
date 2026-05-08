// Playwright diagnostic for Paddle Overlay failure
// 跑：node scripts/diagnose-paddle.mjs

import { chromium } from 'playwright';

const TUNNEL_URL = 'https://memories-explorer-ref-cardiovascular.trycloudflare.com';
const PRICE_ID = 'pri_01kqxh5px07a1ezc42xpta118s';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  // 尽量模拟真实浏览器
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

const consoleLogs = [];
const failedRequests = [];
const paddleRequests = [];

page.on('console', (msg) => {
  consoleLogs.push({ type: msg.type(), text: msg.text() });
});
page.on('pageerror', (err) => {
  consoleLogs.push({ type: 'pageerror', text: err.message });
});
page.on('requestfailed', (req) => {
  failedRequests.push({
    url: req.url(),
    failure: req.failure()?.errorText,
    method: req.method(),
  });
});
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('paddle.com') || url.includes('paddle.js')) {
    paddleRequests.push({
      url,
      status: resp.status(),
      method: resp.request().method(),
    });
  }
});

console.log(`[1] navigating ${TUNNEL_URL}/library`);
await page.goto(`${TUNNEL_URL}/library`, { waitUntil: 'networkidle', timeout: 30000 });

console.log('[2] waiting for window.Paddle to load (max 10s)');
const paddleReady = await page.waitForFunction(
  () => typeof window.Paddle !== 'undefined' && !!window.Paddle.Checkout,
  null,
  { timeout: 10000 },
).then(() => true).catch(() => false);
console.log(`    window.Paddle ready: ${paddleReady}`);

if (!paddleReady) {
  console.log('[2x] Paddle never loaded. Dumping evidence and exiting.');
} else {
  console.log('[3] calling Paddle.Checkout.open with sandbox price');
  await page.evaluate((priceId) => {
    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { recordingId: 'diag_rec_001' },
      settings: { displayMode: 'overlay' },
    });
  }, PRICE_ID);

  console.log('[4] waiting 8s for iframe + network activity');
  await page.waitForTimeout(8000);

  // Inspect iframes
  const frames = page.frames();
  console.log(`[5] frames count: ${frames.length}`);
  for (const f of frames) {
    if (f === page.mainFrame()) continue;
    console.log(`    frame url: ${f.url()}`);
    try {
      const title = await f.title();
      const bodyText = await f.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '(no body)');
      console.log(`    title: ${title}`);
      console.log(`    body preview: ${bodyText.replace(/\s+/g, ' ').slice(0, 200)}`);
    } catch (e) {
      console.log(`    frame inspection failed: ${e.message}`);
    }
  }
}

console.log('\n========== CONSOLE LOGS ==========');
for (const l of consoleLogs) {
  if (l.type === 'error' || l.type === 'pageerror' || l.type === 'warning') {
    console.log(`[${l.type}] ${l.text}`);
  }
}
console.log('  (info/debug suppressed)');

console.log('\n========== FAILED REQUESTS ==========');
for (const r of failedRequests) {
  console.log(`${r.method} ${r.url}\n  -> ${r.failure}`);
}

console.log('\n========== PADDLE-RELATED RESPONSES ==========');
for (const r of paddleRequests) {
  console.log(`${r.status} ${r.method} ${r.url}`);
}

await browser.close();
