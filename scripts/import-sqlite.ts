// One-shot import of a SQLite store file into Postgres (ADR 0001, unit D10). Run it on purpose with
// `npm run db:import-sqlite -- <file>`, as cbs_owner through DATABASE_MIGRATE_URL, against a migrated database;
// nothing imports on app start. Every insert is ON CONFLICT DO NOTHING inside one transaction, so a second run
// changes nothing and a failed run leaves nothing behind.
//
// The superadmin row is skipped: the superadmin is an Authelia group (ADR 0002, decision 3). Every other user
// arrives with authelia_username null and binds by email on first arrival (ADR 0002, decision 5). The plain-text
// password column is dropped.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

type Row = Record<string, unknown>;
type Queryable = Pick<pg.Client, 'query'>;

interface TablePlan { table: string; select: string }

/**
 * Every table the import fills, parents before children: the order db/migrations/0001_baseline.sql creates them.
 * quotation_lines, contract_services and contract_audit_events have no tenant_id in SQLite, so they take their
 * parent's.
 */
export const IMPORT_PLAN: TablePlan[] = [
  { table: 'tenants', select: 'SELECT * FROM tenants' },
  { table: 'users', select: "SELECT * FROM users WHERE role <> 'superadmin'" },
  { table: 'tenant_records', select: 'SELECT * FROM tenant_records' },
  { table: 'tenant_settings', select: 'SELECT * FROM tenant_settings' },
  { table: 'tenant_lifecycle_events', select: 'SELECT * FROM tenant_lifecycle_events' },
  { table: 'operational_logs', select: 'SELECT * FROM operational_logs' },
  { table: 'services', select: 'SELECT * FROM services' },
  { table: 'quotations', select: 'SELECT * FROM quotations' },
  { table: 'quotation_lines', select: 'SELECT quotation_lines.*, quotations.tenant_id FROM quotation_lines JOIN quotations ON quotations.id = quotation_lines.quotation_id' },
  { table: 'invoice_formats', select: 'SELECT * FROM invoice_formats' },
  { table: 'customers', select: 'SELECT * FROM customers' },
  { table: 'contracts', select: 'SELECT * FROM contracts' },
  { table: 'contract_services', select: 'SELECT contract_services.*, contracts.tenant_id FROM contract_services JOIN contracts ON contracts.id = contract_services.contract_id' },
  { table: 'contract_audit_events', select: 'SELECT contract_audit_events.*, contracts.tenant_id FROM contract_audit_events JOIN contracts ON contracts.id = contract_audit_events.contract_id' },
  { table: 'security_deposits', select: 'SELECT * FROM security_deposits' },
  { table: 'security_deposit_settlements', select: 'SELECT * FROM security_deposit_settlements' },
  { table: 'invoices', select: 'SELECT * FROM invoices' },
  { table: 'payments', select: 'SELECT * FROM payments' },
  { table: 'payment_reminders', select: 'SELECT * FROM payment_reminders' },
  { table: 'additional_services', select: 'SELECT * FROM additional_services' },
  { table: 'task_notes', select: 'SELECT * FROM task_notes' },
  { table: 'delivery_log', select: 'SELECT * FROM delivery_log' },
  { table: 'bulk_invoice_runs', select: 'SELECT * FROM bulk_invoice_runs' },
];

/** SQLite columns with no Postgres column, on purpose. */
const DROPPED_COLUMNS: Record<string, string[]> = { users: ['password'] };
/** Postgres tables the import does not copy: migration history, and the counters it derives instead. */
const NOT_COPIED = ['pgmigrations', 'invoice_counters'];

interface TargetColumn { type: string; nullable: boolean; hasDefault: boolean }

export interface TableCount { table: string; source: number; skipped: number; inserted: number; target: number }
export interface ImportReport { tables: TableCount[]; invoiceCounters: number; missing: string[] }

async function targetColumns(client: Queryable): Promise<Map<string, Map<string, TargetColumn>>> {
  const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const tables = new Map<string, Map<string, TargetColumn>>();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
    tables.get(row.table_name)!.set(row.column_name, { type: row.data_type, nullable: row.is_nullable === 'YES', hasDefault: row.column_default !== null });
  }
  return tables;
}

/**
 * The columns and values to insert for one SQLite row. SQLite kept unknown times as '', which no date or timestamptz
 * accepts: such a value is left out where the column has a default, becomes null where it is nullable, and stops the
 * import otherwise.
 */
function insertableRow(table: string, row: Row, columns: Map<string, TargetColumn>): Row {
  const out: Row = {};
  for (const [name, value] of Object.entries(row)) {
    if (DROPPED_COLUMNS[table]?.includes(name)) continue;
    const column = columns.get(name);
    if (!column) throw new Error(`SQLite column ${table}.${name} has no Postgres column. Add it to a migration or to DROPPED_COLUMNS.`);
    const isTime = column.type === 'date' || column.type.startsWith('timestamp');
    if (isTime && value === '') {
      if (column.hasDefault) continue;
      if (column.nullable) { out[name] = null; continue; }
      throw new Error(`${table}.${name} is '' in SQLite row ${JSON.stringify(row.id ?? row)}, and the Postgres column takes no null and has no default.`);
    }
    out[name] = value;
  }
  return out;
}

async function count(client: Queryable, table: string) {
  return Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
}

/** Copies `file` into the database `client` is connected to, in one transaction. `client` must see every row: cbs_owner, which has BYPASSRLS. */
export async function importSqlite(client: Queryable, file: string): Promise<ImportReport> {
  const { rows: [role] } = await client.query<{ name: string; bypass: boolean }>(`SELECT rolname AS name, rolbypassrls OR rolsuper AS bypass FROM pg_roles WHERE rolname = current_user`);
  if (!role?.bypass) throw new Error(`The import runs as cbs_owner (DATABASE_MIGRATE_URL). ${role?.name ?? 'This role'} has no BYPASSRLS, so row-level security would hide the rows it counts.`);

  const source = new DatabaseSync(file, { readOnly: true });
  try {
    const sourceTables = new Set((source.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((row) => row.name));
    const planned = new Set(IMPORT_PLAN.map((plan) => plan.table));
    const unplanned = [...sourceTables].filter((table) => !planned.has(table));
    if (unplanned.length > 0) throw new Error(`The SQLite file has tables the import does not know: ${unplanned.join(', ')}.`);

    const columns = await targetColumns(client);
    const uncovered = [...columns.keys()].filter((table) => !planned.has(table) && !NOT_COPIED.includes(table));
    const absent = [...planned].filter((table) => !columns.has(table));
    if (uncovered.length > 0 || absent.length > 0) throw new Error(`IMPORT_PLAN is out of step with the Postgres schema. Not planned: ${uncovered.join(', ') || 'none'}. Not in Postgres: ${absent.join(', ') || 'none'}.`);

    await client.query('BEGIN');
    try {
      const tables: TableCount[] = [];
      for (const { table, select } of IMPORT_PLAN) {
        const present = sourceTables.has(table);
        const sourceCount = present ? Number((source.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n) : 0;
        const rows = present ? (source.prepare(select).all() as Row[]) : [];
        let inserted = 0;
        for (const row of rows) {
          const values = insertableRow(table, row, columns.get(table)!);
          const names = Object.keys(values);
          const result = await client.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, Object.values(values));
          inserted += result.rowCount ?? 0;
        }
        tables.push({ table, source: sourceCount, skipped: sourceCount - rows.length, inserted, target: await count(client, table) });
      }

      // Numbering continues after the imported invoices: the same start that the first issue takes without a row
      // (src/lib/store/pg/invoices.ts, nextSequence), and never lower than a counter already there.
      const tenantIds = sourceTables.has('tenants') ?(source.prepare('SELECT id FROM tenants').all() as Array<{ id: string }>).map((row) => row.id) : [];
      await client.query(
        `INSERT INTO invoice_counters (tenant_id, last_number)
         SELECT tenants.id, (SELECT count(*) FROM invoices WHERE invoices.tenant_id = tenants.id) FROM tenants WHERE tenants.id = ANY ($1)
         ON CONFLICT (tenant_id) DO UPDATE SET last_number = GREATEST(invoice_counters.last_number, EXCLUDED.last_number)`,
        [tenantIds],
      );
      const invoiceCounters = await count(client, 'invoice_counters');
      await client.query('COMMIT');
      const missing = tables.filter((row) => row.target < row.source - row.skipped).map((row) => row.table);
      return { tables, invoiceCounters, missing };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    source.close();
  }
}

export function formatReport(report: ImportReport) {
  const lines = report.tables.map((row) => `${row.table.padEnd(30)}${String(row.source).padStart(8)}${String(row.skipped).padStart(9)}${String(row.inserted).padStart(10)}${String(row.target).padStart(8)}${report.missing.includes(row.table) ? '  MISSING ROWS' : ''}`);
  return [
    `${'table'.padEnd(30)}${'source'.padStart(8)}${'skipped'.padStart(9)}${'inserted'.padStart(10)}${'target'.padStart(8)}`,
    ...lines,
    `${'invoice_counters (derived)'.padEnd(30)}${'-'.padStart(8)}${'-'.padStart(9)}${'-'.padStart(10)}${String(report.invoiceCounters).padStart(8)}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const connectionString = process.env.DATABASE_MIGRATE_URL;
  if (!file || !connectionString) {
    console.error('Usage: DATABASE_MIGRATE_URL=<cbs_owner URL> npm run db:import-sqlite -- <file.sqlite>');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const report = await importSqlite(client, file);
    console.log(formatReport(report));
    if (report.missing.length > 0) {
      console.error(`Rows from the SQLite file are missing in Postgres for: ${report.missing.join(', ')}. A row with the same key or a unique value was already there.`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}
