// 把 @excalidraw/excalidraw 的字体/资源复制到 public/，供同源加载（避免回退 unpkg CDN）。
// dev / build 前自动执行（package.json 的 predev / prebuild）。幂等、跨平台。
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist');
const publicDir = join(root, 'public');

const dirs = ['excalidraw-assets', 'excalidraw-assets-dev'];

if (!existsSync(distDir)) {
  console.warn('[copy-excalidraw-assets] dist 不存在，跳过：', distDir);
  process.exit(0);
}

mkdirSync(publicDir, { recursive: true });
for (const d of dirs) {
  const src = join(distDir, d);
  if (!existsSync(src)) {
    console.warn('[copy-excalidraw-assets] 源缺失，跳过：', src);
    continue;
  }
  cpSync(src, join(publicDir, d), { recursive: true });
  console.log('[copy-excalidraw-assets] 已复制', d, '→ public/');
}
