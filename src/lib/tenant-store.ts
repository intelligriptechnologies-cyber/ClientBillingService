import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppRole = 'superadmin' | 'admin' | 'user';
export type DemoIdentity = { id: string; name: string; email: string; role: AppRole; tenantId: string | null; tenantName: string | null };
export type AppSession = DemoIdentity;
export type TenantRecord = { id: string; tenantId: string; label: string };
export type TenantUser = { id: string; name: string; email: string; role: Extract<AppRole, 'admin' | 'user'>; status: 'active' | 'disabled' };
export type TenantUserInput = { name: string; email: string; role: TenantUser['role'] };
export type TenantUserUpdate = Partial<TenantUserInput> & { status?: TenantUser['status'] };
export type CustomerStatus = 'active' | 'inactive';
export type InvoiceDelivery = 'monthly' | 'quarterly' | 'email' | 'manual';
export type CustomerRecord = { id: string; tenantId: string; companyName: string; contactName: string; email: string; phone: string; gstin: string; billingAddress: string; invoiceDelivery: InvoiceDelivery; status: CustomerStatus; createdAt: string; updatedAt: string };
export type CustomerInput = Pick<CustomerRecord, 'companyName' | 'contactName' | 'email' | 'phone' | 'gstin' | 'billingAddress' | 'invoiceDelivery'>;
export type CustomerQuery = { search?: string; status?: CustomerStatus; invoiceDelivery?: InvoiceDelivery; page?: number; pageSize?: number };
export type TenantSettings = { companyName: string; gstin: string; address: string; invoicePrefix: string; paymentTermsDays: number; footer: string; invoiceTemplate: string; emailSubject: string; emailBody: string; smtpHost: string; smtpPort: number; smtpFrom: string; logRetentionDays: number; logoDataUrl: string; stampDataUrl: string; signatureDataUrl: string; updatedAt: string };
export type TenantSettingsInput = Omit<TenantSettings, 'updatedAt'>;
export type OperationalLog = { id: string; kind: 'feature-flow' | 'error'; message: string; createdAt: string };

type TenantSeed = { id: string; name: string; adminEmail: string; userEmail: string };

const tenantSeeds: TenantSeed[] = [
  { id: 'nexio', name: 'Nexio Hyper', adminEmail: 'Admin@nexio.com', userEmail: 'user@nexio.com' },
  { id: 'maasp', name: 'MAASP Associates', adminEmail: 'Admin@maasp.com', userEmail: 'user@massp.com' },
  { id: 'evo', name: 'Evo Fitness', adminEmail: 'Admin@evo.com', userEmail: 'user@evo.com' },
  { id: 'gripdata', name: 'Gripdata Analytics', adminEmail: 'Admin@gripdata.com', userEmail: 'user@gripdata.com' },
  { id: 'od', name: 'OD Badminton', adminEmail: 'Admin@od.com', userEmail: 'user@od.com' },
];

function seed(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')));
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'user')), password TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')));
    CREATE TABLE IF NOT EXISTS tenant_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, gstin TEXT NOT NULL, billing_address TEXT NOT NULL, invoice_delivery TEXT NOT NULL CHECK(invoice_delivery IN ('monthly', 'quarterly', 'email', 'manual')), status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), company_name TEXT NOT NULL, gstin TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', invoice_prefix TEXT NOT NULL, payment_terms_days INTEGER NOT NULL, footer TEXT NOT NULL DEFAULT '', invoice_template TEXT NOT NULL, email_subject TEXT NOT NULL, email_body TEXT NOT NULL, smtp_host TEXT NOT NULL DEFAULT '', smtp_port INTEGER NOT NULL DEFAULT 587, smtp_from TEXT NOT NULL DEFAULT '', log_retention_days INTEGER NOT NULL DEFAULT 30, logo_data_url TEXT NOT NULL DEFAULT '', stamp_data_url TEXT NOT NULL DEFAULT '', signature_data_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operational_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL CHECK(kind IN ('feature-flow', 'error')), message TEXT NOT NULL, created_at TEXT NOT NULL);
  `);

  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (tenantCount.count > 0) { seedSettingsForExistingTenants(database); return; }

  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('superadmin', null, 'Demo Superadmin', 'superadmin@ledgerly.demo', 'superadmin', 'admin123', 'active');
    const insertTenant = database.prepare('INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)');
    const insertUser = database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertRecord = database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)');
    const insertCustomer = database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, billing_address, invoice_delivery, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const tenant of tenantSeeds) {
      insertTenant.run(tenant.id, tenant.name, 'active');
      insertUser.run(`${tenant.id}-admin`, tenant.id, `${tenant.name} Admin`, tenant.adminEmail, 'admin', 'admin123', 'active');
      insertUser.run(`${tenant.id}-user`, tenant.id, `${tenant.name} User`, tenant.userEmail, 'user', 'admin123', 'active');
      insertRecord.run(`${tenant.id}-baseline`, tenant.id, `${tenant.name} baseline demo record`);
      const now = '2026-10-01T09:00:00.000Z';
      insertCustomer.run(`${tenant.id}-customer`, tenant.id, `${tenant.name} Customer`, 'Billing Contact', `billing@${tenant.id}.example`, '+91 90000 00000', '29ABCDE1234F1Z5', 'Demo billing address, Bengaluru', 'monthly', 'active', now, now);
    }
    database.exec('COMMIT');
    seedSettingsForExistingTenants(database);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function seedSettingsForExistingTenants(database: DatabaseSync) {
  const tenants = database.prepare('SELECT id, name FROM tenants').all() as Array<{ id: string; name: string }>;
  const insert = database.prepare(`INSERT OR IGNORE INTO tenant_settings (tenant_id, company_name, gstin, address, invoice_prefix, payment_terms_days, footer, invoice_template, email_subject, email_body, smtp_host, smtp_port, smtp_from, log_retention_days, logo_data_url, stamp_data_url, signature_data_url, updated_at) VALUES (?, ?, '', '', ?, 14, 'Thank you for your business.', 'Invoice {{invoiceNumber}} for {{customerName}}', 'Your invoice {{invoiceNumber}}', 'Hello {{customerName}}, please find your invoice attached.', '', 587, '', 30, '', '', '', ?)`);
  for (const tenant of tenants) insert.run(tenant.id, tenant.name, tenant.name.slice(0, 3).toUpperCase(), '2026-10-01T09:00:00.000Z');
}

function customerFromRow(row: Record<string, unknown>): CustomerRecord { return { id: String(row.id), tenantId: String(row.tenant_id), companyName: String(row.company_name), contactName: String(row.contact_name), email: String(row.email), phone: String(row.phone), gstin: String(row.gstin), billingAddress: String(row.billing_address), invoiceDelivery: row.invoice_delivery as InvoiceDelivery, status: row.status as CustomerStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function customerError(input: CustomerInput) { if (!input.companyName.trim()) return 'Company name is required.'; if (!input.contactName.trim()) return 'Contact name is required.'; if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return 'Enter a valid email address.'; if (!input.phone.trim()) return 'Phone is required.'; if (!input.billingAddress.trim()) return 'Billing address is required.'; return null; }

function identityFromRow(row: Record<string, unknown> | undefined): DemoIdentity | null {
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), email: String(row.email), role: row.role as AppRole, tenantId: row.tenant_id ? String(row.tenant_id) : null, tenantName: row.tenant_name ? String(row.tenant_name) : null };
}

function tenantUserFromRow(row: Record<string, unknown>): TenantUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as TenantUser['role'],
    status: row.status as TenantUser['status'],
  };
}

function requireTenantAdmin(session: AppSession): asserts session is AppSession & { tenantId: string; role: 'admin' } {
  if (!session.tenantId) throw new Error('Only a tenant admin can manage users.');
  if (session.role !== 'admin') throw new Error('Only a tenant admin can manage users.');
}

function settingsFromRow(row: Record<string, unknown>): TenantSettings {
  return { companyName: String(row.company_name), gstin: String(row.gstin), address: String(row.address), invoicePrefix: String(row.invoice_prefix), paymentTermsDays: Number(row.payment_terms_days), footer: String(row.footer), invoiceTemplate: String(row.invoice_template), emailSubject: String(row.email_subject), emailBody: String(row.email_body), smtpHost: String(row.smtp_host), smtpPort: Number(row.smtp_port), smtpFrom: String(row.smtp_from), logRetentionDays: Number(row.log_retention_days), logoDataUrl: String(row.logo_data_url), stampDataUrl: String(row.stamp_data_url), signatureDataUrl: String(row.signature_data_url), updatedAt: String(row.updated_at) };
}
function logFromRow(row: Record<string, unknown>): OperationalLog { return { id: String(row.id), kind: row.kind as OperationalLog['kind'], message: String(row.message), createdAt: String(row.created_at) }; }
function validateSettings(input: TenantSettingsInput) {
  if (!input.companyName.trim()) return 'Company name is required.';
  if (!input.invoicePrefix.trim()) return 'Invoice prefix is required.';
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0) return 'Payment terms must be zero or more days.';
  if (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65535) return 'SMTP port must be between 1 and 65535.';
  if (!Number.isInteger(input.logRetentionDays) || input.logRetentionDays < 1 || input.logRetentionDays > 3650) return 'Log retention must be between 1 and 3650 days.';
  return null;
}

export function createTenantStore(filename = process.env.CLIENT_BILLING_DATABASE ?? '.data/client-billing.sqlite') {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  seed(database);
  const withIdentity = `SELECT users.id, users.name, users.email, users.role, users.tenant_id, tenants.name AS tenant_name
    FROM users LEFT JOIN tenants ON tenants.id = users.tenant_id
    WHERE users.status = 'active' AND (users.tenant_id IS NULL OR tenants.status = 'active')`;

  return {
    listIdentities(): DemoIdentity[] {
      return (database.prepare(`${withIdentity} ORDER BY CASE users.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tenants.name`).all() as Record<string, unknown>[]).map((row) => identityFromRow(row)!).filter(Boolean);
    },
    authenticate(userId: string): AppSession | null {
      return identityFromRow(database.prepare(`${withIdentity} AND users.id = ?`).get(userId) as Record<string, unknown> | undefined);
    },
    listTenantRecords(session: AppSession): TenantRecord[] {
      if (!session.tenantId) return [];
      return database.prepare('SELECT id, tenant_id AS tenantId, label FROM tenant_records WHERE tenant_id = ? ORDER BY id').all(session.tenantId) as TenantRecord[];
    },
    createTenantRecord(session: AppSession, tenantId: string, label: string): TenantRecord {
      if (!session.tenantId || session.tenantId !== tenantId) throw new Error('A tenant session may only change its own tenant data.');
      const id = `${tenantId}-${crypto.randomUUID()}`;
      database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)').run(id, tenantId, label);
      return { id, tenantId, label };
    },
    listTenantUsers(session: AppSession): TenantUser[] {
      requireTenantAdmin(session);
      return (database.prepare(`SELECT id, name, email, role, status FROM users
        WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`).all(session.tenantId) as Record<string, unknown>[]).map(tenantUserFromRow);
    },
    createTenantUser(session: AppSession, input: TenantUserInput): TenantUser {
      requireTenantAdmin(session);
      const name = input.name.trim();
      const email = input.email.trim();
      if (!name || !email) throw new Error('A user name and email are required.');
      if (input.role !== 'admin' && input.role !== 'user') throw new Error('Choose an admin or user role.');
      const id = `${session.tenantId}-user-${crypto.randomUUID()}`;
      try {
        database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, session.tenantId, name, email, input.role, 'admin123', 'active');
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A user with that email already exists.');
        throw error;
      }
      return tenantUserFromRow(database.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(id) as Record<string, unknown>);
    },
    updateTenantUser(session: AppSession, userId: string, update: TenantUserUpdate): TenantUser {
      requireTenantAdmin(session);
      const existing = database.prepare('SELECT id, name, email, role, status FROM users WHERE id = ? AND tenant_id = ?').get(userId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('This user does not belong to your tenant.');
      const name = update.name === undefined ? String(existing.name) : update.name.trim();
      const email = update.email === undefined ? String(existing.email) : update.email.trim();
      const role = update.role === undefined ? existing.role as TenantUser['role'] : update.role;
      const status = update.status === undefined ? existing.status as TenantUser['status'] : update.status;
      if (!name || !email) throw new Error('A user name and email are required.');
      if ((role !== 'admin' && role !== 'user') || (status !== 'active' && status !== 'disabled')) throw new Error('Invalid user role or status.');
      try {
        database.prepare('UPDATE users SET name = ?, email = ?, role = ?, status = ? WHERE id = ? AND tenant_id = ?').run(name, email, role, status, userId, session.tenantId);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A user with that email already exists.');
        throw error;
      }
      return tenantUserFromRow(database.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(userId) as Record<string, unknown>);
    },
    listCustomers(session: AppSession, query: CustomerQuery = {}) {
      if (!session.tenantId) return { items: [] as CustomerRecord[], total: 0 };
      const search = query.search?.trim().toLowerCase() ?? ''; const filters = ['tenant_id = ?']; const values: (string | number)[] = [session.tenantId];
      if (search) { filters.push('(lower(company_name) LIKE ? OR lower(contact_name) LIKE ? OR lower(email) LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (query.status) { filters.push('status = ?'); values.push(query.status); } if (query.invoiceDelivery) { filters.push('invoice_delivery = ?'); values.push(query.invoiceDelivery); }
      const where = filters.join(' AND '); const total = (database.prepare(`SELECT count(*) AS count FROM customers WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const items = database.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY company_name LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: items.map(customerFromRow), total };
    },
    createCustomer(session: AppSession, input: CustomerInput) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const error = customerError(input); if (error) throw new Error(error);
      const id = `customer-${crypto.randomUUID()}`; const now = new Date().toISOString();
      database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, billing_address, invoice_delivery, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, session.tenantId, input.companyName.trim(), input.contactName.trim(), input.email.trim(), input.phone.trim(), input.gstin.trim(), input.billingAddress.trim(), input.invoiceDelivery, 'active', now, now);
      return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(id, session.tenantId) as Record<string, unknown>);
    },
    updateCustomer(session: AppSession, customerId: string, input: CustomerInput) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const error = customerError(input); if (error) throw new Error(error);
      const changed = database.prepare('UPDATE customers SET company_name = ?, contact_name = ?, email = ?, phone = ?, gstin = ?, billing_address = ?, invoice_delivery = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(input.companyName.trim(), input.contactName.trim(), input.email.trim(), input.phone.trim(), input.gstin.trim(), input.billingAddress.trim(), input.invoiceDelivery, new Date().toISOString(), customerId, session.tenantId);
      if (!changed.changes) throw new Error('Customer not found.'); return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown>);
    },
    setCustomerStatus(session: AppSession, customerId: string, status: CustomerStatus) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const changed = database.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, new Date().toISOString(), customerId, session.tenantId);
      if (!changed.changes) throw new Error('Customer not found.'); return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown>);
    },
    getTenantSettings(session: AppSession): TenantSettings {
      requireTenantAdmin(session);
      return settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>);
    },
    updateTenantSettings(session: AppSession, input: TenantSettingsInput): TenantSettings {
      requireTenantAdmin(session); const validation = validateSettings(input); if (validation) throw new Error(validation);
      const now = new Date().toISOString();
      database.prepare(`UPDATE tenant_settings SET company_name=?, gstin=?, address=?, invoice_prefix=?, payment_terms_days=?, footer=?, invoice_template=?, email_subject=?, email_body=?, smtp_host=?, smtp_port=?, smtp_from=?, log_retention_days=?, logo_data_url=?, stamp_data_url=?, signature_data_url=?, updated_at=? WHERE tenant_id=?`).run(input.companyName.trim(), input.gstin.trim(), input.address.trim(), input.invoicePrefix.trim().toUpperCase(), input.paymentTermsDays, input.footer.trim(), input.invoiceTemplate.trim(), input.emailSubject.trim(), input.emailBody.trim(), input.smtpHost.trim(), input.smtpPort, input.smtpFrom.trim(), input.logRetentionDays, input.logoDataUrl, input.stampDataUrl, input.signatureDataUrl, now, session.tenantId);
      database.prepare('DELETE FROM operational_logs WHERE tenant_id = ? AND created_at < ?').run(session.tenantId, new Date(Date.now() - input.logRetentionDays * 86_400_000).toISOString());
      database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', 'Tenant settings were updated.', now);
      return this.getTenantSettings(session);
    },
    previewTenantTemplate(session: AppSession): string {
      const settings = this.getTenantSettings(session);
      return settings.invoiceTemplate.replaceAll('{{invoiceNumber}}', `${settings.invoicePrefix}-2026-001`).replaceAll('{{customerName}}', 'Acme Industries');
    },
    testTenantSmtp(session: AppSession): string {
      const settings = this.getTenantSettings(session); const message = `SMTP test prepared for ${settings.smtpFrom || 'the configured sender'}; no external email was sent.`;
      database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', message, new Date().toISOString()); return message;
    },
    listOperationalLogs(session: AppSession): OperationalLog[] {
      requireTenantAdmin(session); return (database.prepare('SELECT id, kind, message, created_at FROM operational_logs WHERE tenant_id = ? ORDER BY created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map(logFromRow);
    },
    close() { database.close(); },
  };
}

let sharedStore: ReturnType<typeof createTenantStore> | undefined;
export function getTenantStore() {
  sharedStore ??= createTenantStore();
  return sharedStore;
}
