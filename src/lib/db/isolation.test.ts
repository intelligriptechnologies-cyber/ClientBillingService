import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { insertRows, seedDemo } from '../../../db/seed/demo';
import { migrate } from './migrate';
import { DATABASE_TESTS_SKIP_REASON, databaseForTest, type TestDatabase } from './test-database';
import { pgTypes } from './types';

// Pre-tenant tables (ADR 0001, Consequences). They stay outside RLS and cbs_app must hold no privilege on them.
// api_tokens arrives with ADR 0002 unit A10; until then it is absent and nothing is checked for it.
const PRE_TENANT_ALLOWLIST = ['tenants', 'api_tokens'];
const MIGRATION_HISTORY = ['pgmigrations'];
const A = 'nexio';
const B = 'maasp';
const AT = '2026-10-02T09:00:00.000Z';

type Row = Record<string, unknown>;

// One row per tenant for every tenant table the demo seed leaves empty, so each case below has rows to see.
const fixtures: Array<[table: string, build: (tenant: string) => Row]> = [
  ['tenant_lifecycle_events', (t) => ({ id: `${t}-event`, tenant_id: t, action: 'updated', detail: 'Fixture.', occurred_at: AT })],
  ['operational_logs', (t) => ({ id: `${t}-log`, tenant_id: t, kind: 'feature-flow', message: 'Fixture.', created_at: AT })],
  ['quotations', (t) => ({ id: `${t}-quote`, tenant_id: t, quote_number: `${t}-Q-001`, customer_name: 'Fixture', status: 'draft', total_minor: 100000, created_at: AT })],
  ['quotation_lines', (t) => ({ id: `${t}-quote-line`, tenant_id: t, quotation_id: `${t}-quote`, service_id: `${t}-service`, service_name: 'Fixture', frequency: 'monthly', quantity: 1, unit_price_minor: 100000, line_total_minor: 100000 })],
  ['contract_audit_events', (t) => ({ id: `${t}-contract-event`, tenant_id: t, contract_id: `${t}-seed-contract`, action: 'created', detail: 'Fixture.', occurred_at: AT })],
  ['security_deposit_settlements', (t) => ({ id: `${t}-settlement`, tenant_id: t, deposit_id: `${t}-seed-deposit`, amount_minor: 1000, note: 'Fixture.', settled_at: AT })],
  ['payment_reminders', (t) => ({ id: `${t}-reminder`, tenant_id: t, invoice_id: `${t}-invoice-001`, channel: 'email', created_at: AT })],
  ['additional_services', (t) => ({ id: `${t}-additional`, tenant_id: t, customer_id: `${t}-customer`, contract_id: `${t}-seed-contract`, service_date: '2026-10-02', description: 'Fixture', price_minor: 5000, status: 'active', created_at: AT, updated_at: AT })],
  ['task_notes', (t) => ({ id: `${t}-note`, tenant_id: t, customer_id: `${t}-customer`, note_date: '2026-10-02', note: 'Fixture.', created_at: AT, updated_at: AT })],
  ['invoice_formats', (t) => ({ id: `${t}-format`, tenant_id: t, name: `${t} format`, definition: { fixture: true }, is_default: 0, created_at: AT, updated_at: AT })],
  ['delivery_log', (t) => ({ id: `${t}-delivery`, tenant_id: t, invoice_id: `${t}-invoice-001`, channel: 'email', to_address: 'billing@example.test', subject: 'Fixture', status: 'sent', attempted_at: AT, attempted_by: `${t}-admin` })],
  ['bulk_invoice_runs', (t) => ({ id: `${t}-bulk-run`, tenant_id: t, billing_period: '2026-09', generated_count: 0, skipped_count: 0, details: [], created_at: AT })],
];

interface CatalogRow { table: string; rls: boolean; force: boolean; has_tenant: boolean; app_privileged: boolean }

function sqlState(error: unknown) {
  return error instanceof Error && 'code' in error ? String(error.code) : `no SQLSTATE (${String(error)})`;
}

describe.skipIf(!process.env.DATABASE_MIGRATE_URL)(`tenant isolation (${DATABASE_TESTS_SKIP_REASON})`, () => {
  let database: TestDatabase;
  let owner: pg.Client;
  let tenantTables: string[] = [];

  const countRows = async (client: pg.Client) => {
    const counts: Record<string, number> = {};
    for (const table of [...tenantTables, 'tenants']) counts[table] = Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    return counts;
  };

  beforeAll(async () => {
    database = await databaseForTest();
    owner = new pg.Client({ connectionString: database.ownerUrl });
    await owner.connect();
    for (const [table, build] of fixtures) await insertRows(owner, table, [build(A), build(B)]);
    await owner.query(`UPDATE customers SET invoice_format_id = tenant_id || '-format' WHERE tenant_id = ANY ($1)`, [[A, B]]);
    const { rows } = await owner.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND a.attname = 'tenant_id' AND NOT a.attisdropped
          AND c.relname <> ALL ($1) ORDER BY 1`,
      [PRE_TENANT_ALLOWLIST],
    );
    tenantTables = rows.map((row) => row.table);
  });
  afterAll(async () => {
    await owner?.end();
    await database?.drop();
  });

  it('forces row-level security on every tenant table and keeps cbs_app off every other table', async () => {
    const { rows } = await owner.query<CatalogRow>(
      `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant,
              has_table_privilege('cbs_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS app_privileged
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') ORDER BY 1`,
    );
    const problems = rows.flatMap((row) => {
      if ([...PRE_TENANT_ALLOWLIST, ...MIGRATION_HISTORY].includes(row.table)) return row.app_privileged ? [`${row.table}: cbs_app holds a privilege on a pre-tenant table`] : [];
      if (!row.has_tenant) return [`${row.table}: no tenant_id column and not in the pre-tenant allowlist`];
      if (!row.rls || !row.force) return [`${row.table}: row-level security ${row.rls ? 'enabled' : 'disabled'}, ${row.force ? 'forced' : 'not forced'}`];
      return [];
    });
    expect(problems).toEqual([]);
    expect(rows.map((row) => row.table)).toContain('tenants');
    expect(tenantTables.length).toBeGreaterThan(20);
  });

  it('makes every foreign key between tenant tables carry tenant_id', async () => {
    const { rows } = await owner.query<{ name: string; definition: string }>(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND confrelid <> 'tenants'::regclass
          AND NOT (conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = conrelid AND attname = 'tenant_id')]
               AND confkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = confrelid AND attname = 'tenant_id')])`,
    );
    expect(rows).toEqual([]);
  });

  it('keeps the public schema grants from db/roles.sql', async () => {
    const { rows } = await owner.query(
      `SELECT pg_get_userbyid(nspowner) AS owner, has_schema_privilege('cbs_app', 'public', 'USAGE') AS app_usage,
              has_schema_privilege('cbs_app', 'public', 'CREATE') AS app_create
         FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(rows[0]).toEqual({ owner: 'cbs_owner', app_usage: true, app_create: false });
  });

  it('returns no rows to cbs_app without a tenant context, on a fresh connection and after a committed one', async () => {
    const app = new pg.Client({ connectionString: database.appUrl, types: pgTypes });
    await app.connect();
    try {
      const visible = async () => {
        const seen: string[] = [];
        for (const table of tenantTables) {
          const count = Number((await app.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
          if (count !== 0) seen.push(`${table}: ${count}`);
        }
        return seen;
      };
      expect(await visible()).toEqual([]);
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [A]);
      await app.query('COMMIT');
      expect(await visible()).toEqual([]);
    } finally {
      await app.end();
    }
  });

  it('shows tenant A its own rows and none of tenant B', async () => {
    const problems = await database.db.withTenant(A, async (tx) => {
      const found: string[] = [];
      for (const table of tenantTables) {
        const { rows } = await tx.query<{ own: number; other: number }>(`SELECT count(*) FILTER (WHERE tenant_id = $1) AS own, count(*) FILTER (WHERE tenant_id <> $1) AS other FROM ${table}`, [A]);
        if (rows[0].own === 0 || rows[0].other !== 0) found.push(`${table}: own ${rows[0].own}, other ${rows[0].other}`);
      }
      return found;
    });
    expect(problems).toEqual([]);
    for (const table of tenantTables) {
      const { rows } = await owner.query(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [B]);
      expect(Number(rows[0].n), `${table} has a tenant B row for the test to hide`).toBeGreaterThan(0);
    }
  });

  it('rejects a row tagged with tenant B written under tenant A (42501)', async () => {
    const problems: string[] = [];
    for (const table of tenantTables) {
      const { rows } = await owner.query<{ row: Row }>(`SELECT row_to_json(t) AS row FROM ${table} t WHERE tenant_id = $1 LIMIT 1`, [B]);
      const row = rows[0].row;
      if ('id' in row) row.id = `${String(row.id)}-tagged-b`;
      const code = await database.db.withTenant(A, (tx) => tx.query(`INSERT INTO ${table} SELECT * FROM json_populate_record(NULL::${table}, $1)`, [row])).then(() => 'inserted', sqlState);
      if (code !== '42501') problems.push(`${table}: ${code}`);
    }
    expect(problems).toEqual([]);
  });

  it('rejects a tenant A row that references tenant B rows (23503)', async () => {
    const { rows: keys } = await owner.query<{ table: string; columns: string[] }>(
      `SELECT conrelid::regclass::text AS table, array_agg(a.attname::text) AS columns
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.confrelid <> 'tenants'::regclass AND a.attname <> 'tenant_id'
        GROUP BY 1 ORDER BY 1`,
    );
    expect(keys.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const { table, columns } of keys) {
      const { rows } = await owner.query<{ row: Row }>(`SELECT row_to_json(t) AS row FROM ${table} t WHERE tenant_id = $1 AND ${columns.map((column) => `${column} IS NOT NULL`).join(' AND ')} LIMIT 1`, [B]);
      if (rows.length === 0) { problems.push(`${table}: no tenant B row with ${columns.join(', ')} set`); continue; }
      const row = { ...rows[0].row, tenant_id: A };
      if ('id' in row) row.id = `${String(row.id)}-cross-tenant`;
      const code = await database.db.withTenant(A, (tx) => tx.query(`INSERT INTO ${table} SELECT * FROM json_populate_record(NULL::${table}, $1)`, [row])).then(() => 'inserted', sqlState);
      if (code !== '23503') problems.push(`${table}: ${code}`);
    }
    expect(problems).toEqual([]);
  });

  it('lets withPlatform read the tenants table and every tenant row', async () => {
    const counts = await database.db.withPlatform(async (tx) => (await tx.query(`SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(DISTINCT tenant_id) FROM users) AS user_tenants`)).rows[0]);
    expect(counts).toEqual({ tenants: 5, user_tenants: 5 });
  });

  it('reads seeded rows through withTenant in the shapes the store returns today', async () => {
    const row = await database.db.withTenant(A, async (tx) => (await tx.query(`SELECT total_minor, gst_rate, invoice_date, issued_at, snapshot FROM invoices WHERE id = $1`, [`${A}-invoice-001`])).rows[0]);
    expect(row).toEqual({ total_minor: 118000, gst_rate: 18, invoice_date: '2026-10-01', issued_at: '2026-10-01T09:00:00.000Z', snapshot: expect.objectContaining({ gstRate: 18 }) });
  });

  it('treats a second migrator run as a no-op', async () => {
    const fingerprint = async () => (await owner.query(
      `SELECT (SELECT json_agg(name ORDER BY id) FROM pgmigrations) AS history,
              (SELECT md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' ORDER BY table_name, column_name)) FROM information_schema.columns WHERE table_schema = 'public') AS columns,
              (SELECT md5(string_agg(conname || pg_get_constraintdef(oid), ',' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'public'::regnamespace) AS constraints,
              (SELECT md5(string_agg(indexdef, ',' ORDER BY indexname)) FROM pg_indexes WHERE schemaname = 'public') AS indexes,
              (SELECT md5(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), ',' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'public') AS policies`,
    )).rows[0];
    const before = await fingerprint();
    expect(before.history).toEqual(['0001_baseline']);
    await migrate(database.ownerUrl);
    expect(await fingerprint()).toEqual(before);
  });

  it('leaves identical row counts after a second seed run', async () => {
    const before = await countRows(owner);
    expect(before.tenants).toBe(5);
    expect(before.users).toBe(10);
    await seedDemo(owner);
    expect(await countRows(owner)).toEqual(before);
  });
});
