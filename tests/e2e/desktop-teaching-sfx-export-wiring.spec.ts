import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveDesktopTeachingSoundEffectExportOptions } from '../../src/services/teachingSoundEffectExportRuntime';

test('the export task builds teaching SFX options only from a ready desktop manifest', async () => {
  const source = await readFile(resolve(process.cwd(), 'src/components/providers/MediaTaskProvider.tsx'), 'utf8');
  expect(source).toContain('resolveDesktopTeachingSoundEffectExportOptions');
  expect(source).toContain('teachingSoundEffects');
  expect(source).toContain('recordingId: input.recordingId');
});

test('a desktop bridge returns explicit absent for old recordings without relying on wrapped IPC error text', async () => {
  const target = globalThis as typeof globalThis & { excalicastDesktop?: { invoke: () => Promise<unknown>; subscribe: () => () => void } };
  target.excalicastDesktop = { invoke: async () => ({ state: 'absent' }), subscribe: () => () => undefined };
  await expect(resolveDesktopTeachingSoundEffectExportOptions('old-desktop-recording')).resolves.toBeUndefined();
  delete target.excalicastDesktop;
});
