import type { DatabaseSync } from 'node:sqlite';
import { stateFromGstin } from '../gst';
import { now } from './shared';

type TenantSeed = { id: string; name: string; adminEmail: string; userEmail: string };

const tenantSeeds: TenantSeed[] = [
  { id: 'nexio', name: 'Nexio Hyper', adminEmail: 'Admin@nexio.com', userEmail: 'user@nexio.com' },
  { id: 'maasp', name: 'MAASP Associates', adminEmail: 'Admin@maasp.com', userEmail: 'user@massp.com' },
  { id: 'evo', name: 'Evo Fitness', adminEmail: 'Admin@evo.com', userEmail: 'user@evo.com' },
  { id: 'gripdata', name: 'Gripdata Analytics', adminEmail: 'Admin@gripdata.com', userEmail: 'user@gripdata.com' },
  { id: 'od', name: 'OD Badminton', adminEmail: 'Admin@od.com', userEmail: 'user@od.com' },
];

export function seed(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')), created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'user')), password TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')), created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS tenant_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), monthly_minor INTEGER NOT NULL, quarterly_minor INTEGER NOT NULL, half_yearly_minor INTEGER NOT NULL, annual_minor INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, name));
    CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), quote_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT, status TEXT NOT NULL CHECK(status IN ('draft')), archived_at TEXT, total_minor INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id, quote_number));
    CREATE TABLE IF NOT EXISTS quotation_lines (id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE, service_id TEXT NOT NULL, service_name TEXT NOT NULL, frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')), quantity INTEGER NOT NULL, unit_price_minor INTEGER NOT NULL, line_total_minor INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, gstin TEXT NOT NULL, billing_address TEXT NOT NULL, invoice_delivery TEXT NOT NULL CHECK(invoice_delivery IN ('monthly', 'quarterly', 'email', 'manual')), status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_lifecycle_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'disabled', 'enabled')), detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), company_name TEXT NOT NULL, gstin TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', invoice_prefix TEXT NOT NULL, payment_terms_days INTEGER NOT NULL, footer TEXT NOT NULL DEFAULT '', invoice_template TEXT NOT NULL, email_subject TEXT NOT NULL, email_body TEXT NOT NULL, smtp_host TEXT NOT NULL DEFAULT '', smtp_port INTEGER NOT NULL DEFAULT 587, smtp_from TEXT NOT NULL DEFAULT '', log_retention_days INTEGER NOT NULL DEFAULT 30, logo_data_url TEXT NOT NULL DEFAULT '', stamp_data_url TEXT NOT NULL DEFAULT '', signature_data_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operational_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL CHECK(kind IN ('feature-flow', 'error')), message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, value_minor INTEGER NOT NULL, payment_terms_days INTEGER NOT NULL, billing_frequency TEXT NOT NULL CHECK(billing_frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')), invoice_months TEXT NOT NULL, cycle_day INTEGER NOT NULL, escalation_percent REAL NOT NULL, escalation_review_date TEXT, renewal_notice_days INTEGER NOT NULL, security_deposit_minor INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contract_services (contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(contract_id, service_id));
    CREATE TABLE IF NOT EXISTS security_deposits (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), contract_id TEXT NOT NULL REFERENCES contracts(id), customer_id TEXT NOT NULL REFERENCES customers(id), amount_minor INTEGER NOT NULL, settled_minor INTEGER NOT NULL DEFAULT 0, settlement_note TEXT, settled_at TEXT, status TEXT NOT NULL CHECK(status IN ('held', 'settled')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS security_deposit_settlements (id TEXT PRIMARY KEY, deposit_id TEXT NOT NULL REFERENCES security_deposits(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), amount_minor INTEGER NOT NULL, note TEXT NOT NULL, settled_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contract_audit_events (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, action TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), contract_id TEXT REFERENCES contracts(id), customer_id TEXT NOT NULL REFERENCES customers(id), invoice_number TEXT NOT NULL, invoice_date TEXT NOT NULL, due_date TEXT NOT NULL, taxable_minor INTEGER NOT NULL, gst_rate REAL NOT NULL, gst_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL, paid_minor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('issued', 'paid', 'partial', 'overdue', 'void')), snapshot TEXT NOT NULL, issued_at TEXT NOT NULL, UNIQUE(tenant_id, invoice_number));
    CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES invoices(id), payment_date TEXT NOT NULL, amount_minor INTEGER NOT NULL, tds_minor INTEGER NOT NULL DEFAULT 0, write_off_minor INTEGER NOT NULL DEFAULT 0, method TEXT NOT NULL CHECK(method IN ('bank_transfer', 'cash', 'card', 'cheque', 'other')), reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_reminders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES invoices(id), channel TEXT NOT NULL CHECK(channel IN ('email', 'whatsapp')), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS additional_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), contract_id TEXT NOT NULL REFERENCES contracts(id), service_date TEXT NOT NULL, description TEXT NOT NULL, price_minor INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active', 'archived')), billed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_notes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), note_date TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS task_notes_tenant_date ON task_notes(tenant_id, note_date DESC);
    CREATE TABLE IF NOT EXISTS invoice_formats (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, definition TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, name COLLATE NOCASE));
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_formats_one_default ON invoice_formats(tenant_id) WHERE is_default = 1;
    CREATE TABLE IF NOT EXISTS delivery_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES invoices(id), channel TEXT NOT NULL CHECK(channel IN ('email')), to_address TEXT NOT NULL, cc_address TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sent', 'failed', 'not-configured')), error TEXT NOT NULL DEFAULT '', attempted_at TEXT NOT NULL, attempted_by TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS delivery_log_invoice ON delivery_log(tenant_id, invoice_id, attempted_at DESC);
    CREATE TABLE IF NOT EXISTS bulk_invoice_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), billing_period TEXT NOT NULL, generated_count INTEGER NOT NULL, skipped_count INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id, billing_period));
  `);
  for (const statement of ["ALTER TABLE tenants ADD COLUMN created_at TEXT NOT NULL DEFAULT ''", "ALTER TABLE tenants ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''", "ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT ''", 'ALTER TABLE users ADD COLUMN authelia_username TEXT', "ALTER TABLE quotations ADD COLUMN archived_at TEXT", 'ALTER TABLE security_deposits ADD COLUMN settled_minor INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE security_deposits ADD COLUMN settlement_note TEXT', 'ALTER TABLE security_deposits ADD COLUMN settled_at TEXT', "ALTER TABLE tenant_settings ADD COLUMN legal_name TEXT NOT NULL DEFAULT ''", "ALTER TABLE tenant_settings ADD COLUMN state_code TEXT NOT NULL DEFAULT ''", "ALTER TABLE customers ADD COLUMN state_code TEXT NOT NULL DEFAULT ''", "ALTER TABLE services ADD COLUMN hsn_sac TEXT NOT NULL DEFAULT ''", 'ALTER TABLE customers ADD COLUMN invoice_format_id TEXT', "ALTER TABLE tenant_settings ADD COLUMN smtp_user TEXT NOT NULL DEFAULT ''", "ALTER TABLE tenant_settings ADD COLUMN smtp_password TEXT NOT NULL DEFAULT ''"]) { try { database.exec(statement); } catch { /* Existing database. */ } }
  backfillStateCodes(database);
  database.prepare("UPDATE users SET created_at = COALESCE((SELECT NULLIF(tenants.created_at, '') FROM tenants WHERE tenants.id = users.tenant_id), ?) WHERE created_at = ''").run(now());

  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (tenantCount.count > 0) { seedSettings(database); return; }

  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('superadmin', null, 'Demo Superadmin', 'superadmin@ledgerly.demo', 'superadmin', 'admin123', 'active');
    const timestamp = now();
    const insertTenant = database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertUser = database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertRecord = database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)');
    const insertCustomer = database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, state_code, billing_address, invoice_delivery, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertService = database.prepare('INSERT INTO services (id, tenant_id, name, description, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const tenant of tenantSeeds) {
      insertTenant.run(tenant.id, tenant.name, 'active', timestamp, timestamp);
      insertUser.run(`${tenant.id}-admin`, tenant.id, `${tenant.name} Admin`, tenant.adminEmail, 'admin', 'admin123', 'active');
      insertUser.run(`${tenant.id}-user`, tenant.id, `${tenant.name} User`, tenant.userEmail, 'user', 'admin123', 'active');
      insertRecord.run(`${tenant.id}-baseline`, tenant.id, `${tenant.name} baseline demo record`);
      const now = '2026-10-01T09:00:00.000Z';
      insertCustomer.run(`${tenant.id}-customer`, tenant.id, `${tenant.name} Customer`, 'Billing Contact', `billing@${tenant.id}.example`, '+91 90000 00000', '29AAGCB7383J1Z4', '29', 'Demo billing address, Bengaluru', 'monthly', 'active', now, now);
      insertService.run(`${tenant.id}-service`, tenant.id, 'Managed billing service', 'Seeded recurring billing service', 'active', 100000, 280000, 540000, 1000000, now, now);
    }
    database.exec('COMMIT');
    seedSettings(database); seedInvoices(database); seedOperationalScenarios(database);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
/** Older rows kept free-text GSTINs. Fill the state from every one that passes validation and leave the rest blank. */
export function backfillStateCodes(database: DatabaseSync) {
  for (const table of ['customers', 'tenant_settings'] as const) {
    const key = table === 'customers' ? 'id' : 'tenant_id';
    const rows = database.prepare(`SELECT ${key} AS key, gstin FROM ${table} WHERE state_code = '' AND gstin != ''`).all() as Array<{ key: string; gstin: string }>;
    const update = database.prepare(`UPDATE ${table} SET state_code = ? WHERE ${key} = ?`);
    for (const row of rows) { const state = stateFromGstin(row.gstin); if (state) update.run(state.stateCode, row.key); }
  }
}
export function seedSettings(database: DatabaseSync) { const rows = database.prepare('SELECT id, name FROM tenants').all() as Array<{ id: string; name: string }>; const insert = database.prepare(`INSERT OR IGNORE INTO tenant_settings (tenant_id, company_name, gstin, address, invoice_prefix, payment_terms_days, footer, invoice_template, email_subject, email_body, smtp_host, smtp_port, smtp_from, log_retention_days, logo_data_url, stamp_data_url, signature_data_url, updated_at) VALUES (?, ?, '', '', ?, 14, 'Thank you for your business.', 'Invoice {{invoiceNumber}} for {{customerName}}', 'Your invoice {{invoiceNumber}}', 'Hello {{customerName}}, please find your invoice attached.', '', 587, '', 30, '', '', '', ?)`); for (const row of rows) insert.run(row.id, row.name, row.name.slice(0, 3).toUpperCase(), '2026-10-01T09:00:00.000Z'); }
function seedInvoices(database: DatabaseSync) { const rows = database.prepare('SELECT tenants.id, tenants.name, customers.id AS customer_id, customers.email, customers.billing_address FROM tenants JOIN customers ON customers.tenant_id = tenants.id').all() as Array<{ id: string; name: string; customer_id: string; email: string; billing_address: string }>; const insert = database.prepare('INSERT OR IGNORE INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'); for (const row of rows) { const taxableMinor = 100000; const gstMinor = 18000; const snapshot = JSON.stringify({ companyName: row.name, gstin: '', address: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: `${row.name} Customer`, customerEmail: row.email, customerAddress: row.billing_address, gstRate: 18, footer: 'Thank you for your business.' }); insert.run(`${row.id}-invoice-001`, row.id, row.customer_id, `${row.name.slice(0, 3).toUpperCase()}-2026-001`, '2026-10-01', '2026-10-15', taxableMinor, 18, gstMinor, taxableMinor + gstMinor, 'issued', snapshot, '2026-10-01T09:00:00.000Z'); } }
function seedOperationalScenarios(database: DatabaseSync) {
  const rows = database.prepare('SELECT tenants.id, tenants.name, customers.id AS customer_id, customers.email, customers.billing_address FROM tenants JOIN customers ON customers.tenant_id = tenants.id').all() as Array<{ id: string; name: string; customer_id: string; email: string; billing_address: string }>;
  const timestamp = '2026-10-01T09:00:00.000Z';
  const insertContract = database.prepare(`INSERT OR IGNORE INTO contracts (id, tenant_id, customer_id, name, start_date, end_date, value_minor, payment_terms_days, billing_frequency, invoice_months, cycle_day, escalation_percent, escalation_review_date, renewal_notice_days, security_deposit_minor, status, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-01-01', '2026-12-31', 100000, 14, 'monthly', '[]', 1, 0, NULL, 30, 25000, 'active', ?, ?)`);
  const insertContractService = database.prepare('INSERT OR IGNORE INTO contract_services (contract_id, service_id) VALUES (?, ?)');
  const insertDeposit = database.prepare(`INSERT OR IGNORE INTO security_deposits (id, tenant_id, contract_id, customer_id, amount_minor, settled_minor, status, created_at) VALUES (?, ?, ?, ?, 25000, 0, 'held', ?)`);
  const insertInvoice = database.prepare(`INSERT OR IGNORE INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, ?, ?, ?, '2026-09-01', '2026-09-15', 100000, 18, 18000, 118000, 118000, 'paid', ?, ?)`);
  const insertPayment = database.prepare(`INSERT OR IGNORE INTO payments (id, tenant_id, invoice_id, payment_date, amount_minor, tds_minor, write_off_minor, method, reference, notes, recorded_at) VALUES (?, ?, ?, '2026-09-10', 100000, 18000, 0, 'bank_transfer', 'SEED-PAID', 'Seeded settled invoice.', ?)`);
  const linkCurrentInvoice = database.prepare('UPDATE invoices SET contract_id = ? WHERE id = ? AND tenant_id = ?');
  for (const row of rows) {
    const contractId = `${row.id}-seed-contract`;
    const currentInvoiceId = `${row.id}-invoice-001`;
    const paidInvoiceId = `${row.id}-invoice-payment-001`;
    const prefix = row.name.slice(0, 3).toUpperCase();
    const snapshot = JSON.stringify({ companyName: row.name, gstin: '', address: '', logoDataUrl: '', stampDataUrl: '', signatureDataUrl: '', customerName: `${row.name} Customer`, customerEmail: row.email, customerAddress: row.billing_address, gstRate: 18, footer: 'Thank you for your business.' });
    insertContract.run(contractId, row.id, row.customer_id, `${row.name} managed billing contract`, timestamp, timestamp);
    insertContractService.run(contractId, `${row.id}-service`);
    insertDeposit.run(`${row.id}-seed-deposit`, row.id, contractId, row.customer_id, timestamp);
    linkCurrentInvoice.run(contractId, currentInvoiceId, row.id);
    insertInvoice.run(paidInvoiceId, row.id, contractId, row.customer_id, `${prefix}-2026-000`, snapshot, timestamp);
    insertPayment.run(`${row.id}-seed-payment`, row.id, paidInvoiceId, timestamp);
  }
}
