import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const svg = fs.readFileSync(path.join(cwd, 'public/brand/excalicast-logo.svg'), 'utf8');

async function render(size, outPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
            #logo { width: ${size}px; height: ${size}px; display: grid; place-items: center; }
            svg { width: ${size}px; height: ${size}px; display: block; }
          </style>
        </head>
        <body><div id="logo">${svg}</div></body>
      </html>
    `);
    await page.locator('#logo').screenshot({ path: path.join(cwd, outPath), omitBackground: true });
  } finally {
    await browser.close();
  }
}

await render(512, 'src/app/icon.png');
await render(180, 'src/app/apple-icon.png');
