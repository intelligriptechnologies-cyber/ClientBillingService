import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from './database';

export const DATABASE_TESTS_SKIP_REASON = 'needs DATABASE_MIGRATE_URL; skipped without it, start Postgres with `npm run db:up`';
export const TEMPLATE_DATABASE = 'cbs_test_template';
export const CLONE_PREFIX = 'cbs_test_';

export interface TestDatabaseUrls { admin: string; owner: string; app: string; platform: string }

/** DATABASE_ADMIN_URL is a superuser, used only to create and drop test databases: cbs_owner has NOCREATEDB on purpose. */
export function testDatabaseUrls(): TestDatabaseUrls {
  const names = { admin: 'DATABASE_ADMIN_URL', owner: 'DATABASE_MIGRATE_URL', app: 'DATABASE_URL', platform: 'DATABASE_PLATFORM_URL' } as const;
  const missing = Object.values(names).filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`Database tests need ${missing.join(', ')} (see .env.example).`);
  return { admin: process.env[names.admin]!, owner: process.env[names.owner]!, app: process.env[names.app]!, platform: process.env[names.platform]! };
}

export function onDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
  /** withTenant connects as cbs_app and withPlatform as cbs_platform, both on this clone. */
  db: Database;
  drop(): Promise<void>;
}

/** Clones the migrated, seeded template that the Vitest global setup built. Call once per test file and drop it in afterAll. */
export async function databaseForTest(): Promise<TestDatabase> {
  const urls = testDatabaseUrls();
  const name = `${CLONE_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  await withClient(urls.admin, (admin) => admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`));
  const db = createDatabase({ app: onDatabase(urls.app, name), platform: onDatabase(urls.platform, name) });
  return {
    name,
    ownerUrl: onDatabase(urls.owner, name),
    appUrl: onDatabase(urls.app, name),
    db,
    async drop() {
      await db.end();
      await withClient(urls.admin, (admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}
