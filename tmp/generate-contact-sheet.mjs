import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dirs = [
  '/Users/chenzhijiang/.codex/generated_images/019ef88c-f9ed-7a21-bcc7-23c77067490f',
  '/Users/chenzhijiang/.codex/generated_images/019ed081-d961-7921-a138-a7b847888693',
  '/Users/chenzhijiang/.codex/generated_images/019efe16-f9a7-7651-b019-c2d6010f834d',
];

const files = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((name) => /\.(png|jpg|webp)$/i.test(name))) {
    const fullPath = path.join(dir, file);
    files.push({ file, fullPath, mtime: fs.statSync(fullPath).mtimeMs });
  }
}

files.sort((a, b) => b.mtime - a.mtime);
const offset = Number.parseInt(process.argv[2] ?? '0', 10) || 0;
const chosen = files.slice(offset, offset + 24);
const cards = chosen
  .map((entry, index) => {
    const ext = path.extname(entry.file).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const b64 = fs.readFileSync(entry.fullPath).toString('base64');
    return `
      <div class="card">
        <div class="idx">${offset + index + 1}</div>
        <img src="data:${mime};base64,${b64}" />
        <div class="name">${entry.file}</div>
      </div>
    `;
  })
  .join('');

const html = `
  <!doctype html>
  <style>
    body { margin: 0; background: #f7f3ec; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; }
    .card { background: white; border: 1px solid #ddd6cb; border-radius: 12px; padding: 10px; box-shadow: 0 8px 20px rgba(0,0,0,.07); }
    .idx { font-weight: 800; font-size: 18px; margin-bottom: 6px; }
    .name { font-size: 10px; line-height: 1.25; word-break: break-all; margin-top: 8px; color: #333; }
    img { width: 100%; height: 260px; object-fit: contain; background: #eee9df; border-radius: 8px; }
  </style>
  <div class="grid">${cards}</div>
`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 2800 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.screenshot({ path: `tmp/generated-design-contact-sheet-${offset}.png`, fullPage: true, timeout: 60000 });
await browser.close();
console.log(`wrote tmp/generated-design-contact-sheet-${offset}.png`);
