import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Electron registers a privileged teaching asset protocol resolved from the owned project manifest', async () => {
  const source = await readFile(resolve(process.cwd(), 'apps/desktop/src/main.ts'), 'utf8');
  expect(source).toContain('TEACHING_ASSET_SCHEME');
  expect(source).toContain('registerTeachingAssetProtocol()');
  expect(source).toContain('createTeachingAssetResponse(request');
  expect(source).toContain('resolveTeachingAssetFromManifest({');
  expect(source).toContain("cacheRoot: path.join(app.getPath('userData'), 'Teaching Assets')");
  expect(source).toContain('teachingAssetCache');
  expect(source).toContain('createTeachingAssetResponse(request, resolveCachedTeachingAsset)');
  expect(source).toContain('for (const entry of teachingAssetCache.values())');
  expect(source).toContain('teachingAssetResolutionFlights');
  expect(source).toContain('activeLeases');
  expect(source).not.toContain('file://');
});
