import { chromium } from 'playwright';

const URL = 'https://excalicast.vercel.app/landing';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.screenshot({ path: '/tmp/excalicast-landing.png', fullPage: true });

const links = await page.$$eval('a[href^="/"]', (els) => els.map(e => ({ text: e.textContent?.trim() ?? '', href: e.href })));
const hasPaddle = await page.$$eval('a', (els) => els.some(e => e.textContent?.includes('Paddle')));
const priceShown = await page.$$eval('body', (els) => els[0].innerText.includes('$9.99'));
const contactShown = await page.$$eval('body', (els) => els[0].innerText.includes('hello@excalicast.app'));

console.log(`landing URL: ${URL}`);
console.log(`page errors: ${errors.length}`);
errors.forEach(e => console.log('  ' + e));
console.log(`internal links: ${links.length}`);
links.forEach(l => console.log(`  ${l.text} → ${l.href}`));
console.log(`mentions Paddle: ${hasPaddle}`);
console.log(`price visible ($9.99): ${priceShown}`);
console.log(`contact visible: ${contactShown}`);
console.log(`screenshot saved to /tmp/excalicast-landing.png`);

await browser.close();
