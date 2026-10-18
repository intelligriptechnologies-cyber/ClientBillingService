import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const migrateUrl = process.env.DATABASE_MIGRATE_URL;

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
}

describe.skipIf(!migrateUrl)('database roles (needs DATABASE_MIGRATE_URL; skipped without it, start Postgres with `npm run db:up`)', () => {
  const client = new Client({ connectionString: migrateUrl });
  const roles = new Map<string, RoleRow>();

  beforeAll(async () => {
    await client.connect();
    const { rows } = await client.query<RoleRow>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1)`,
      [['cbs_owner', 'cbs_app', 'cbs_platform']],
    );
    for (const row of rows) roles.set(row.rolname, row);
  });
  afterAll(() => client.end());

  it('creates all three roles with login', () => {
    expect([...roles.keys()].sort()).toEqual(['cbs_app', 'cbs_owner', 'cbs_platform']);
    for (const role of roles.values()) expect(role.rolcanlogin, role.rolname).toBe(true);
  });

  it('keeps cbs_app a plain role that cannot bypass row-level security', () => {
    expect(roles.get('cbs_app')).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('gives cbs_owner and cbs_platform BYPASSRLS without superuser', () => {
    expect(roles.get('cbs_owner')).toMatchObject({ rolsuper: false, rolbypassrls: true });
    expect(roles.get('cbs_platform')).toMatchObject({ rolsuper: false, rolbypassrls: true });
  });

  it('lets cbs_app own no table, schema or database', async () => {
    const tables = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = 'cbs_app' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
    );
    expect(tables.rows).toEqual([]);
    const schemas = await client.query(
      `SELECT n.nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = 'cbs_app'`,
    );
    expect(schemas.rows).toEqual([]);
    const databases = await client.query(
      `SELECT d.datname FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = 'cbs_app'`,
    );
    expect(databases.rows).toEqual([]);
  });

  it('makes cbs_owner own the public schema and lets only cbs_owner create in it', async () => {
    const { rows } = await client.query<{ owner: string; app_create: boolean; platform_create: boolean; app_usage: boolean; platform_usage: boolean }>(
      `SELECT pg_get_userbyid(nspowner) AS owner,
              has_schema_privilege('cbs_app', 'public', 'CREATE') AS app_create,
              has_schema_privilege('cbs_platform', 'public', 'CREATE') AS platform_create,
              has_schema_privilege('cbs_app', 'public', 'USAGE') AS app_usage,
              has_schema_privilege('cbs_platform', 'public', 'USAGE') AS platform_usage
         FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(rows[0]).toEqual({ owner: 'cbs_owner', app_create: false, platform_create: false, app_usage: true, platform_usage: true });
  });
});
