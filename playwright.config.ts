import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Browser journeys intentionally share a database within one serial run, but
// never inherit mutations from an earlier run or a developer's local demo.
const databasePath = process.env.CLIENT_BILLING_DATABASE ?? resolve('.data', 'client-billing-e2e.sqlite');
process.env.CLIENT_BILLING_DATABASE = databasePath;
const testPort = Number(process.env.CLIENT_BILLING_TEST_PORT) || 3100;

export default defineConfig({
  testDir: './e2e',
  // The demo intentionally uses one persistent SQLite database, so its acceptance
  // journeys must not mutate the same tenant data concurrently.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: `http://localhost:${testPort}`, trace: 'retain-on-failure' },
  webServer: { command: process.env.CLIENT_BILLING_TEST_USE_START ? `npm run start -- --port ${testPort}` : `npm run dev -- --webpack --port ${testPort}`, url: `http://localhost:${testPort}`, env: { ...process.env, CLIENT_BILLING_DATABASE: databasePath, CLIENT_BILLING_SEED_MODE: 'demo' }, reuseExistingServer: !process.env.CI && !process.env.CLIENT_BILLING_TEST_PORT },
});
