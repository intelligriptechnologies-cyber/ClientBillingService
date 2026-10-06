import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The demo intentionally uses one persistent SQLite database, so its acceptance
  // journeys must not mutate the same tenant data concurrently.
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --webpack --port 3100', url: 'http://localhost:3100', reuseExistingServer: !process.env.CI },
});
