import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const assets = [
  'paper-sky',
  'soft-mint',
  'warm-yellow',
  'lavender-note',
  'charcoal-paper',
  'candy-flow',
  'blush-garden',
  'pastel-haze',
  'aurora-snow',
  'dawn-mountain',
  'leaf-paper',
  'neon-dusk',
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const cards = assets
  .map((id) => {
    const svg = fs.readFileSync(path.join(cwd, 'public/video-backgrounds', `${id}.svg`), 'utf8');
    return `<div class="card">${svg}<span>${id}</span></div>`;
  })
  .join('');

await page.setContent(`
  <style>
    body{margin:0;background:#f7f3ee;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;padding:28px}
    .card{background:white;border-radius:28px;box-shadow:0 18px 45px rgba(30,24,18,.14);overflow:hidden}
    .card svg{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
    .card span{display:block;padding:12px 16px 16px;color:#352f2a;font-size:18px}
  </style>
  <div class="grid">${cards}</div>
`, { waitUntil: 'load' });

await page.screenshot({ path: 'tmp/video-backgrounds-preview.png', fullPage: true });
await browser.close();
