import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const migrationsDir = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

/** Applies pending migrations as the role in `databaseUrl` (cbs_owner). `npm run db:migrate` runs the same files through the CLI. */
export async function migrate(databaseUrl: string) {
  await runner({ databaseUrl, dir: migrationsDir, migrationsTable: 'pgmigrations', direction: 'up', log: () => {} });
}
