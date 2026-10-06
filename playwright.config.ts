import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

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
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --webpack --port 3100', url: 'http://localhost:3100', env: { ...process.env, CLIENT_BILLING_DATABASE: databasePath }, reuseExistingServer: !process.env.CI },
});
