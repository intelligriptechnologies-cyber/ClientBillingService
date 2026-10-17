import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { demoOrigin, demoPort } from './e2e/test-ports';

// Browser journeys intentionally share a database within one serial run, but
// never inherit mutations from an earlier run or a developer's local demo.
const databasePath = process.env.CLIENT_BILLING_DATABASE ?? resolve('.data', 'client-billing-e2e.sqlite');
process.env.CLIENT_BILLING_DATABASE = databasePath;

export default defineConfig({
  testDir: './e2e',
  // The demo intentionally uses one persistent SQLite database, so its acceptance
  // journeys must not mutate the same tenant data concurrently.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // The app rejects cookie POSTs without an Origin, and Playwright's API requests send none.
  use: { baseURL: demoOrigin, trace: 'retain-on-failure', extraHTTPHeaders: { Origin: demoOrigin } },
  webServer: { command: process.env.CLIENT_BILLING_TEST_USE_START ? `npm run start -- --port ${demoPort}` : `npm run dev -- --webpack --port ${demoPort}`, url: demoOrigin, env: { ...process.env, CLIENT_BILLING_DATABASE: databasePath, CLIENT_BILLING_SEED_MODE: 'demo' }, reuseExistingServer: !process.env.CI && !process.env.CLIENT_BILLING_TEST_PORT },
});
