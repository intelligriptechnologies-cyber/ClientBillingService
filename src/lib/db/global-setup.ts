import { seedDemo } from '../../../db/seed/demo';
import { migrate } from './migrate';
import { withClient, CLONE_PREFIX, onDatabase, TEMPLATE_DATABASE, testDatabaseUrls } from './test-database';

// Vitest global setup: rebuilds the template that databaseForTest() clones. Without DATABASE_MIGRATE_URL it does
// nothing, and the database tests skip by name.
export default async function setup() {
  if (!process.env.DATABASE_MIGRATE_URL) return;
  const urls = testDatabaseUrls();
  await withClient(urls.admin, async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE starts_with(datname, $1)`, [CLONE_PREFIX]);
    for (const { datname } of rows) await admin.query(`DROP DATABASE ${datname} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  });
  // The per-database half of db/roles.sql. The roles themselves are cluster-wide and already exist; the
  // isolation test asserts these grants on every clone.
  await withClient(onDatabase(urls.admin, TEMPLATE_DATABASE), (admin) => admin.query(`
    ALTER SCHEMA public OWNER TO cbs_owner;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO cbs_app, cbs_platform;
  `));
  const ownerUrl = onDatabase(urls.owner, TEMPLATE_DATABASE);
  await migrate(ownerUrl);
  await withClient(ownerUrl, seedDemo);
}
