// One source for the ports and secrets that playwright.config.ts and the specs both need.
// Never port 3000: a developer's own dev server owns it.
export const demoPort = Number(process.env.CLIENT_BILLING_TEST_PORT) || 3100;
export const autheliaPort = demoPort + 1;
export const bootRefusalPort = demoPort + 2;

export const demoOrigin = `http://localhost:${demoPort}`;
export const autheliaOrigin = `http://localhost:${autheliaPort}`;

/** The database both e2e servers use. Global setup rebuilds it, migrated and seeded, before every run. */
export const e2eDatabase = 'cbs_e2e';

function onDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The four role URLs from .env.example, pointed at cbs_e2e. Postgres is the only e2e database, so a missing one stops the run. */
export function e2eDatabaseUrls() {
  const names = { admin: 'DATABASE_ADMIN_URL', owner: 'DATABASE_MIGRATE_URL', app: 'DATABASE_URL', platform: 'DATABASE_PLATFORM_URL' } as const;
  const missing = Object.values(names).filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`The e2e run needs Postgres: set ${missing.join(', ')} (see .env.example; \`npm run db:up\` prints them).`);
  return {
    adminServer: process.env[names.admin]!,
    admin: onDatabase(process.env[names.admin]!, e2eDatabase),
    owner: onDatabase(process.env[names.owner]!, e2eDatabase),
    app: onDatabase(process.env[names.app]!, e2eDatabase),
    platform: onDatabase(process.env[names.platform]!, e2eDatabase),
  };
}

export const proxySecret ='e2e-proxy-secret-e2e-proxy-secret-0123';
export const memberGroup = 'cbs-users';
export const superadminGroup = 'cbs-superadmin';
