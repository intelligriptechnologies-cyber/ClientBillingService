// `npm run db:up` starts the dev Postgres from docker-compose.dev.yml and applies db/roles.sql.
// `npm run db:down` stops it and keeps the data. `npm run db:down -- --volumes` also deletes the data.
// Set COMPOSE_PROJECT_NAME to run a second copy beside the default `cbs-dev` project.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const compose = ['compose', '-f', 'docker-compose.dev.yml'];

function docker(args, input) {
  const result = spawnSync('docker', [...compose, ...args], { cwd: root, stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'], input });
  if (result.error) throw new Error(`Could not run docker: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const [command, ...flags] = process.argv.slice(2);
if (command === 'up') {
  docker(['up', '-d', '--wait']);
  const sql = readFileSync(new URL('../db/roles.sql', import.meta.url));
  docker(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'cbs', '-v', 'ON_ERROR_STOP=1', '-q'], sql);
  console.log(`
Postgres is up on localhost:5433 with the roles from db/roles.sql. Export these to use it:
  DATABASE_URL=postgres://cbs_app:cbs_app_dev_only@localhost:5433/cbs
  DATABASE_PLATFORM_URL=postgres://cbs_platform:cbs_platform_dev_only@localhost:5433/cbs
  DATABASE_MIGRATE_URL=postgres://cbs_owner:cbs_owner_dev_only@localhost:5433/cbs
  DATABASE_ADMIN_URL=postgres://postgres:postgres_dev_only@localhost:5433/postgres   (tests only)`);
} else if (command === 'down') {
  docker(['down', ...(flags.includes('--volumes') ? ['--volumes'] : [])]);
} else {
  console.error('Usage: node scripts/db.mjs up | down [--volumes]');
  process.exit(2);
}
