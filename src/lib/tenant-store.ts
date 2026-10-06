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
export type BillingFrequency = 'monthly' | 'quarterly' | 'halfYearly' | 'annual';
export type ServicePrices = Record<BillingFrequency, number>;
export type TenantService = { id: string; name: string; description: string; status: 'active' | 'inactive'; prices: ServicePrices; createdAt: string; updatedAt: string };
export type ServiceInput = { name: string; description?: string; prices: ServicePrices };
export type ServiceUpdate = Partial<ServiceInput> & { status?: TenantService['status'] };
export type QuotationLine = { id: string; serviceId: string; serviceName: string; frequency: BillingFrequency; quantity: number; unitPriceMinor: number; lineTotalMinor: number };
export type Quotation = { id: string; quoteNumber: string; customerName: string; customerEmail: string | null; status: 'draft'; lines: QuotationLine[]; totalMinor: number; createdAt: string };
export type QuotationInput = { customerName: string; customerEmail?: string; lines: Array<{ serviceId: string; frequency: BillingFrequency; quantity: number }> };

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
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), monthly_minor INTEGER NOT NULL, quarterly_minor INTEGER NOT NULL, half_yearly_minor INTEGER NOT NULL, annual_minor INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, name));
    CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), quote_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT, status TEXT NOT NULL CHECK(status IN ('draft')), total_minor INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id, quote_number));
    CREATE TABLE IF NOT EXISTS quotation_lines (id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE, service_id TEXT NOT NULL, service_name TEXT NOT NULL, frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')), quantity INTEGER NOT NULL, unit_price_minor INTEGER NOT NULL, line_total_minor INTEGER NOT NULL);
  `);

  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (tenantCount.count > 0) return;

  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('superadmin', null, 'Demo Superadmin', 'superadmin@ledgerly.demo', 'superadmin', 'admin123', 'active');
    const insertTenant = database.prepare('INSERT INTO tenants (id, name, status) VALUES (?, ?, ?)');
    const insertUser = database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertRecord = database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)');
    for (const tenant of tenantSeeds) {
      insertTenant.run(tenant.id, tenant.name, 'active');
      insertUser.run(`${tenant.id}-admin`, tenant.id, `${tenant.name} Admin`, tenant.adminEmail, 'admin', 'admin123', 'active');
      insertUser.run(`${tenant.id}-user`, tenant.id, `${tenant.name} User`, tenant.userEmail, 'user', 'admin123', 'active');
      insertRecord.run(`${tenant.id}-baseline`, tenant.id, `${tenant.name} baseline demo record`);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

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

function requireTenantMember(session: AppSession): asserts session is AppSession & { tenantId: string } {
  if (!session.tenantId || session.role === 'superadmin') throw new Error('Choose a tenant session to manage billing data.');
}

function serviceFromRow(row: Record<string, unknown>): TenantService {
  return { id: String(row.id), name: String(row.name), description: String(row.description), status: row.status as TenantService['status'], prices: { monthly: Number(row.monthly_minor), quarterly: Number(row.quarterly_minor), halfYearly: Number(row.half_yearly_minor), annual: Number(row.annual_minor) }, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function validateServiceInput(input: ServiceInput) {
  if (!input.name.trim()) throw new Error('A service name is required.');
  for (const price of Object.values(input.prices)) if (!Number.isInteger(price) || price < 0) throw new Error('Service prices must be non-negative whole minor units.');
}

function quotationFromRow(database: DatabaseSync, row: Record<string, unknown>): Quotation {
  const lines = (database.prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY id').all(String(row.id)) as Record<string, unknown>[]).map((line) => ({
    id: String(line.id), serviceId: String(line.service_id), serviceName: String(line.service_name), frequency: line.frequency as BillingFrequency, quantity: Number(line.quantity), unitPriceMinor: Number(line.unit_price_minor), lineTotalMinor: Number(line.line_total_minor),
  }));
  return { id: String(row.id), quoteNumber: String(row.quote_number), customerName: String(row.customer_name), customerEmail: row.customer_email ? String(row.customer_email) : null, status: 'draft', lines, totalMinor: Number(row.total_minor), createdAt: String(row.created_at) };
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
    listServices(session: AppSession, query = ''): TenantService[] {
      requireTenantMember(session);
      const search = `%${query.trim().toLowerCase()}%`;
      return (database.prepare(`SELECT * FROM services WHERE tenant_id = ? AND (lower(name) LIKE ? OR lower(description) LIKE ?) ORDER BY name COLLATE NOCASE`).all(session.tenantId, search, search) as Record<string, unknown>[]).map(serviceFromRow);
    },
    getService(session: AppSession, serviceId: string): TenantService | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(serviceId, session.tenantId) as Record<string, unknown> | undefined;
      return row ? serviceFromRow(row) : null;
    },
    createService(session: AppSession, input: ServiceInput): TenantService {
      requireTenantMember(session);
      validateServiceInput(input);
      const id = `${session.tenantId}-service-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      try {
        database.prepare(`INSERT INTO services (id, tenant_id, name, description, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
          .run(id, session.tenantId, input.name.trim(), input.description?.trim() ?? '', input.prices.monthly, input.prices.quarterly, input.prices.halfYearly, input.prices.annual, now, now);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A service with that name already exists in this tenant.');
        throw error;
      }
      return serviceFromRow(database.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>);
    },
    updateService(session: AppSession, serviceId: string, update: ServiceUpdate): TenantService {
      requireTenantMember(session);
      const current = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(serviceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!current) throw new Error('This service does not belong to your tenant.');
      const input: ServiceInput = { name: update.name ?? String(current.name), description: update.description ?? String(current.description), prices: update.prices ?? { monthly: Number(current.monthly_minor), quarterly: Number(current.quarterly_minor), halfYearly: Number(current.half_yearly_minor), annual: Number(current.annual_minor) } };
      validateServiceInput(input);
      const status = update.status ?? current.status as TenantService['status'];
      if (status !== 'active' && status !== 'inactive') throw new Error('Invalid service status.');
      try {
        database.prepare(`UPDATE services SET name = ?, description = ?, status = ?, monthly_minor = ?, quarterly_minor = ?, half_yearly_minor = ?, annual_minor = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(input.name.trim(), input.description?.trim() ?? '', status, input.prices.monthly, input.prices.quarterly, input.prices.halfYearly, input.prices.annual, new Date().toISOString(), serviceId, session.tenantId);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A service with that name already exists in this tenant.');
        throw error;
      }
      return serviceFromRow(database.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) as Record<string, unknown>);
    },
    listQuotations(session: AppSession): Quotation[] {
      requireTenantMember(session);
      return (database.prepare('SELECT * FROM quotations WHERE tenant_id = ? ORDER BY created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map((row) => quotationFromRow(database, row));
    },
    getQuotation(session: AppSession, quotationId: string): Quotation | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (row.tenant_id !== session.tenantId) throw new Error('This quotation does not belong to your tenant.');
      return quotationFromRow(database, row);
    },
    createQuotation(session: AppSession, input: QuotationInput): Quotation {
      requireTenantMember(session);
      const customerName = input.customerName.trim();
      if (!customerName || !input.lines.length) throw new Error('Choose a customer name and at least one service.');
      const quoteId = `${session.tenantId}-quote-${crypto.randomUUID()}`;
      const serviceStatement = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\'');
      const lines = input.lines.map((line, index): QuotationLine => {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Quotation quantities must be positive whole numbers.');
        if (!['monthly', 'quarterly', 'halfYearly', 'annual'].includes(line.frequency)) throw new Error('Choose a supported billing frequency.');
        const service = serviceStatement.get(line.serviceId, session.tenantId) as Record<string, unknown> | undefined;
        if (!service) throw new Error('A quotation service must belong to your tenant and be active.');
        const prices = serviceFromRow(service).prices;
        return { id: `${quoteId}-line-${index + 1}`, serviceId: line.serviceId, serviceName: String(service.name), frequency: line.frequency, quantity: line.quantity, unitPriceMinor: prices[line.frequency], lineTotalMinor: prices[line.frequency] * line.quantity };
      });
      const totalMinor = lines.reduce((total, line) => total + line.lineTotalMinor, 0);
      const sequence = Number((database.prepare('SELECT COUNT(*) AS count FROM quotations WHERE tenant_id = ?').get(session.tenantId) as { count: number }).count) + 1;
      const quoteNumber = `Q-${session.tenantId.toUpperCase()}-${String(sequence).padStart(4, '0')}`;
      const now = new Date().toISOString();
      database.exec('BEGIN');
      try {
        database.prepare(`INSERT INTO quotations (id, tenant_id, quote_number, customer_name, customer_email, status, total_minor, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
          .run(quoteId, session.tenantId, quoteNumber, customerName, input.customerEmail?.trim() || null, totalMinor, now);
        const insertLine = database.prepare('INSERT INTO quotation_lines (id, quotation_id, service_id, service_name, frequency, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const line of lines) insertLine.run(line.id, quoteId, line.serviceId, line.serviceName, line.frequency, line.quantity, line.unitPriceMinor, line.lineTotalMinor);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return quotationFromRow(database, database.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as Record<string, unknown>);
    },
    close() { database.close(); },
  };
}

let sharedStore: ReturnType<typeof createTenantStore> | undefined;
export function getTenantStore() {
  sharedStore ??= createTenantStore();
  return sharedStore;
}
