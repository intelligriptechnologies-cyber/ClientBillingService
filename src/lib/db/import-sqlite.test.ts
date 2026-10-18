import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { formatReport, importSqlite, IMPORT_PLAN } from '../../../scripts/import-sqlite';
import { createPgStore } from '../store/pg/create-pg-store';
import { createDatabase } from './database';
import { CLONE_PREFIX, createMigratedDatabase, DATABASE_TESTS_SKIP_REASON, onDatabase, testDatabaseUrls, withClient } from './test-database';

const SEED_FILE = resolve('seed', 'initial-data.sqlite');

function sourceCounts(file: string) {
  const source = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(IMPORT_PLAN.map(({ table }) => [table, Number((source.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n)]));
  } finally {
    source.close();
  }
}

async function targetCounts(client: pg.Client) {
  const counts: Record<string, number> = {};
  for (const { table } of IMPORT_PLAN) counts[table] = Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  return counts;
}

describe.skipIf(!process.env.DATABASE_MIGRATE_URL)(`the one-shot SQLite import (${DATABASE_TESTS_SKIP_REASON})`, () => {
  const databases: string[] = [];
  const clients: pg.Client[] = [];
  const directories: string[] = [];

  /** An empty, migrated database with no demo seed, as the import expects on a server. */
  async function emptyDatabase() {
    const name = `${CLONE_PREFIX}import_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    databases.push(name);
    const owner = new pg.Client({ connectionString: await createMigratedDatabase(name) });
    await owner.connect();
    clients.push(owner);
    return { name, owner };
  }

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.end();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await withClient(testDatabaseUrls().admin, async (admin) => {
      for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
  });

  it('leaves the source counts after importing seed/initial-data.sqlite twice, less the superadmin, with every user unbound', async () => {
    const { owner } = await emptyDatabase();
    const source = sourceCounts(SEED_FILE);
    expect(source).toMatchObject({ tenants: 5, users: 11, customers: 3, contracts: 1, quotations: 1, invoices: 0 });

    const first = await importSqlite(owner, SEED_FILE);
    const second = await importSqlite(owner, SEED_FILE);

    expect(await targetCounts(owner)).toEqual({ ...source, users: source.users - 1 });
    expect(first.missing).toEqual([]);
    expect(second.missing).toEqual([]);
    expect(second.tables.filter((row) => row.inserted > 0)).toEqual([]);
    expect(formatReport(second)).toMatch(/^users\s+11\s+1\s+0\s+10$/m);

    const users = await owner.query<{ id: string; authelia_username: string | null }>('SELECT id, authelia_username FROM users ORDER BY id');
    expect(users.rows.map((row) => row.id)).not.toContain('superadmin');
    expect(users.rows.filter((row) => row.authelia_username !== null)).toEqual([]);
    const childTenants = await owner.query(`SELECT (SELECT tenant_id FROM quotation_lines) AS quotation_line, (SELECT tenant_id FROM contract_services) AS contract_service, (SELECT tenant_id FROM contract_audit_events) AS contract_event`);
    expect(childTenants.rows[0]).toEqual({ quotation_line: 'nexio', contract_service: 'nexio', contract_event: 'nexio' });
    const counters = await owner.query<{ tenant_id: string; last_number: string }>('SELECT tenant_id, last_number FROM invoice_counters ORDER BY tenant_id');
    expect(counters.rows).toEqual(['evo', 'gripdata', 'maasp', 'nexio', 'od'].map((tenant_id) => ({ tenant_id, last_number: '0' })));
  });

  it('starts each tenant\'s invoice counter at its imported invoices, so the next issue takes the next number', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cbs-import-'));
    directories.push(directory);
    const file = join(directory, 'with-invoices.sqlite');
    copyFileSync(SEED_FILE, file);
    const writable = new DatabaseSync(file);
    const prefix = String((writable.prepare(`SELECT invoice_prefix FROM tenant_settings WHERE tenant_id = 'nexio'`).get() as { invoice_prefix: string }).invoice_prefix);
    const customerId = String((writable.prepare(`SELECT id FROM customers WHERE tenant_id = 'nexio' LIMIT 1`).get() as { id: string }).id);
    const insert = writable.prepare(`INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at)
      VALUES (?, 'nexio', NULL, ?, ?, '2026-10-01', '2026-10-15', 1000, 0, 0, 1000, 0, 'issued', '{}', '2026-10-01T09:00:00.000Z')`);
    insert.run('imported-invoice-1', customerId, `${prefix}-0001`);
    insert.run('imported-invoice-2', customerId, `${prefix}-0002`);
    writable.close();

    const { name, owner } = await emptyDatabase();
    await importSqlite(owner, file);
    const counters = await owner.query<{ tenant_id: string; last_number: string }>(`SELECT tenant_id, last_number FROM invoice_counters WHERE tenant_id IN ('nexio', 'evo') ORDER BY tenant_id`);
    expect(counters.rows).toEqual([{ tenant_id: 'evo', last_number: '0' }, { tenant_id: 'nexio', last_number: '2' }]);

    const urls = testDatabaseUrls();
    const store = createPgStore(createDatabase({ app: onDatabase(urls.app, name), platform: onDatabase(urls.platform, name) }));
    try {
      const issued = await store.createIssuedInvoice({ tenantId: 'nexio', actor: { kind: 'user', id: 'nexio-admin', username: null } }, { customerId, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 100 });
      expect(issued.invoiceNumber).toBe(`${prefix}-0003`);
    } finally {
      await store.close();
    }
  });

  it('refuses to run as a role that row-level security filters', async () => {
    const { name } = await emptyDatabase();
    await withClient(onDatabase(testDatabaseUrls().app, name), async (app) => {
      await expect(importSqlite(app, SEED_FILE)).rejects.toThrow('BYPASSRLS');
    });
  });
});
