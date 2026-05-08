import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3001';
const PAGES = ['/landing', '/privacy', '/terms', '/refund'];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
  // Make sure we capture the inner scrollable container, not just viewport
  const scrollContainer = await page.$('main');
  let height = 900;
  if (scrollContainer) {
    height = await scrollContainer.evaluate((el) => el.scrollHeight) || 900;
    await page.setViewportSize({ width: 1280, height: Math.min(height + 60, 4000) });
  }
  const out = `/tmp/excalicast${path.replace(/\//g, '-')}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`${path} (h=${height}) -> ${out}`);
}

await browser.close();
