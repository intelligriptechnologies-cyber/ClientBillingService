import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { autheliaOrigin, autheliaPort, demoOrigin, demoPort, e2eDatabaseUrls, memberGroup, proxySecret, superadminGroup } from './e2e/test-ports';

// Browser journeys intentionally share one Postgres database (cbs_e2e) within a serial run. Global setup rebuilds
// it, so a run never inherits mutations from an earlier run or from a developer's own database.
const database = e2eDatabaseUrls();
const databaseEnv = { DATABASE_URL: database.app, DATABASE_PLATFORM_URL: database.platform };
// The demo server writes outgoing mail here instead of sending it, and specs read it back.
process.env.CLIENT_BILLING_MAIL_CAPTURE_FILE ??= resolve('.data', 'mail-capture.json');

const serverCommand = (port: number) => process.env.CLIENT_BILLING_TEST_USE_START ? `npm run start -- --port ${port}` : `npm run dev -- --webpack --port ${port}`;
const reuseExistingServer = !process.env.CI && !process.env.CLIENT_BILLING_TEST_PORT;

export default defineConfig({
  testDir: './e2e',
  // The demo intentionally uses one persistent database, so its acceptance
  // journeys must not mutate the same tenant data concurrently.
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // The app rejects cookie POSTs without an Origin, and Playwright's API requests send none.
  use: { baseURL: demoOrigin, trace: 'retain-on-failure', extraHTTPHeaders: { Origin: demoOrigin } },
  webServer: [
    { command: serverCommand(demoPort), url: demoOrigin, env: { ...process.env, ...databaseEnv, CLIENT_BILLING_MAIL_TRANSPORT: 'capture' }, reuseExistingServer },
    {
      // A second server in authelia mode. Next locks one dist directory per dev server, so it gets its own.
      command: serverCommand(autheliaPort),
      url: `${autheliaOrigin}/api/health`,
      env: {
        ...process.env,
        ...databaseEnv,
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
