import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalicast-payment-config-'));
process.env.EXCALICAST_DB_PATH = path.join(dir, 'test.db');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const paymentConfig = require('../../src/lib/paymentConfig');

test.describe('payment config storage', () => {
  test('atomically activates one row and records an audit entry', async () => {
    await paymentConfig.activateConfig('paddle', 'test', 'admin@example.com');

    const all = await paymentConfig.listAllConfigs();
    expect(all.filter((row: { isActive: boolean }) => row.isActive)).toHaveLength(1);
    expect(all.find((row: { isActive: boolean }) => row.isActive)).toMatchObject({
      provider: 'paddle',
      mode: 'test',
    });
    await expect(paymentConfig.listPaymentConfigAudit()).resolves.toEqual([
      expect.objectContaining({
        actor: 'admin@example.com',
        action: 'activate',
        provider: 'paddle',
        mode: 'test',
      }),
    ]);
  });
});
