import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const localSupabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const localSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'e2e-local-anon-key';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: localSupabaseURL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabaseAnonKey,
        },
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
