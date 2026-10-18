import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import pg from 'pg';
import { SCHEMA_GRANTS } from '../src/lib/db/schema-grants';
import { e2eDatabase, e2eDatabaseUrls } from './test-ports';

async function run(url: string, ...statements: string[]) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Runs one of the operator's own scripts against cbs_e2e, as cbs_owner. */
function asOwner(owner: string, script: string[]) {
  const result = spawnSync(process.execPath, script, { env: { ...process.env, DATABASE_MIGRATE_URL: owner }, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`node ${script.join(' ')} exited with ${result.status ?? result.signal}.`);
}

// Playwright starts the web servers before this runs. They connect lazily, and DROP ... WITH (FORCE) ends any
// connection a reused server still holds, so every run starts from the migrated, seeded demo data.
export default async function globalSetup() {
  const urls = e2eDatabaseUrls();
  rmSync(process.env.CLIENT_BILLING_MAIL_CAPTURE_FILE!, { force: true });
  await run(urls.adminServer, `DROP DATABASE IF EXISTS ${e2eDatabase} WITH (FORCE)`, `CREATE DATABASE ${e2eDatabase}`);
  await run(urls.admin, SCHEMA_GRANTS);
  // The migrator and the seed are ES modules that Playwright's loader cannot require, so each runs in its own node.
  asOwner(urls.owner, ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', 'up', '-m', 'db/migrations', '-d', 'DATABASE_MIGRATE_URL', '--no-verbose']);
  asOwner(urls.owner, ['db/seed/demo.ts']);
}
