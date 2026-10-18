import { seedDemo } from '../../../db/seed/demo';
import { withClient, CLONE_PREFIX, createMigratedDatabase, TEMPLATE_DATABASE, testDatabaseUrls } from './test-database';

// Vitest global setup: rebuilds the template that databaseForTest() clones. Without DATABASE_MIGRATE_URL it does
// nothing, and the database tests skip by name.
export default async function setup() {
  if (!process.env.DATABASE_MIGRATE_URL) return;
  const urls = testDatabaseUrls();
  await withClient(urls.admin, async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE starts_with(datname, $1)`, [CLONE_PREFIX]);
    for (const { datname } of rows) await admin.query(`DROP DATABASE ${datname} WITH (FORCE)`);
  });
  const ownerUrl = await createMigratedDatabase(TEMPLATE_DATABASE, urls);
  await withClient(ownerUrl, seedDemo);
}
