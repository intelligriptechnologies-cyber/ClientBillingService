import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { autheliaOrigin, autheliaPort, demoOrigin, demoPort, memberGroup, proxySecret, superadminGroup } from './e2e/test-ports';

// Browser journeys intentionally share a database within one serial run, but
// never inherit mutations from an earlier run or a developer's local demo.
const databasePath = process.env.CLIENT_BILLING_DATABASE ?? resolve('.data', 'client-billing-e2e.sqlite');
process.env.CLIENT_BILLING_DATABASE = databasePath;

const serverCommand = (port: number) => process.env.CLIENT_BILLING_TEST_USE_START ? `npm run start -- --port ${port}` : `npm run dev -- --webpack --port ${port}`;
const reuseExistingServer = !process.env.CI && !process.env.CLIENT_BILLING_TEST_PORT;

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
  webServer: [
    { command: serverCommand(demoPort), url: demoOrigin, env: { ...process.env, CLIENT_BILLING_DATABASE: databasePath, CLIENT_BILLING_SEED_MODE: 'demo' }, reuseExistingServer },
    {
      // A second server in authelia mode. Next locks one dist directory per dev server, so it gets its own.
      command: serverCommand(autheliaPort),
      url: `${autheliaOrigin}/api/health`,
      env: {
        ...process.env,
        CLIENT_BILLING_DATABASE: ':memory:',
        CLIENT_BILLING_SEED_MODE: 'demo',
        // `next start` takes no lock and reads the one production build, so only dev needs a second dist dir.
        ...(process.env.CLIENT_BILLING_TEST_USE_START ? {} : { CLIENT_BILLING_DIST_DIR: '.next-authelia' }),
        CLIENT_BILLING_ENV: 'test',
        CLIENT_BILLING_AUTH_MODE: 'authelia',
        CBS_PROXY_SECRET: proxySecret,
        CBS_AUTH_MEMBER_GROUP: memberGroup,
        CBS_AUTH_SUPERADMIN_GROUP: superadminGroup,
        CBS_AUTHELIA_LOGOUT_URL: 'https://auth.example.test/logout',
        CBS_PUBLIC_ORIGIN: autheliaOrigin,
      },
      reuseExistingServer,
    },
  ],
});
