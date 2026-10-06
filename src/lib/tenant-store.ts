import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppRole = 'superadmin' | 'admin' | 'user';
export type DemoIdentity = { id: string; name: string; email: string; role: AppRole; tenantId: string | null; tenantName: string | null };
export type AppSession = DemoIdentity;
export type TenantRecord = { id: string; tenantId: string; label: string };
export type TenantStatus = 'active' | 'disabled';
export type Tenant = { id: string; name: string; status: TenantStatus; createdAt: string; updatedAt: string; userCount: number };
export type TenantHistoryEvent = { id: string; tenantId: string; action: 'created' | 'updated' | 'disabled' | 'enabled'; detail: string; occurredAt: string };
export type TenantList = { items: Tenant[]; total: number };
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
export type CustomerStatus = 'active' | 'inactive';
export type InvoiceDelivery = 'monthly' | 'quarterly' | 'email' | 'manual';
export type CustomerRecord = { id: string; tenantId: string; companyName: string; contactName: string; email: string; phone: string; gstin: string; billingAddress: string; invoiceDelivery: InvoiceDelivery; status: CustomerStatus; createdAt: string; updatedAt: string };
export type CustomerInput = Pick<CustomerRecord, 'companyName' | 'contactName' | 'email' | 'phone' | 'gstin' | 'billingAddress' | 'invoiceDelivery'>;
export type CustomerQuery = { search?: string; status?: CustomerStatus; invoiceDelivery?: InvoiceDelivery; page?: number; pageSize?: number };
export type ContractStatus = 'active' | 'inactive';
export type Contract = { id: string; tenantId: string; customerId: string; customerName: string; name: string; serviceIds: string[]; services: string[]; startDate: string; endDate: string; valueMinor: number; paymentTermsDays: number; billingFrequency: BillingFrequency; invoiceMonths: number[]; cycleDay: number; escalationPercent: number; escalationReviewDate: string | null; renewalNoticeDays: number; securityDepositMinor: number; status: ContractStatus; createdAt: string; updatedAt: string };
export type ContractInput = Omit<Contract, 'id' | 'tenantId' | 'customerName' | 'services' | 'status' | 'createdAt' | 'updatedAt' | 'escalationReviewDate'> & { escalationReviewDate: string };
export type ContractUpdate = Partial<ContractInput> & { status?: ContractStatus };
export type ContractQuery = { search?: string; status?: ContractStatus; customerId?: string; page?: number; pageSize?: number };
export type ContractList = { items: Contract[]; total: number };
export type AdditionalServiceStatus = 'active' | 'archived';
export type AdditionalService = { id: string; tenantId: string; customerId: string; customerName: string; contractId: string; contractName: string; serviceDate: string; description: string; priceMinor: number; notes: string; status: AdditionalServiceStatus; billedAt: string | null; createdAt: string; updatedAt: string };
export type AdditionalServiceInput = { customerId: string; contractId: string; serviceDate: string; description: string; priceMinor: number; notes?: string };
export type AdditionalServiceUpdate = Partial<AdditionalServiceInput> & { status?: AdditionalServiceStatus };
export type AdditionalServiceQuery = { search?: string; customerId?: string; contractId?: string; status?: AdditionalServiceStatus; billingPeriod?: string; page?: number; pageSize?: number };
export type AdditionalServiceList = { items: AdditionalService[]; total: number };
export type SecurityDeposit = { id: string; contractId: string; customerId: string; customerName: string; amountMinor: number; status: 'held' | 'settled'; createdAt: string };
export type TenantSettings = { companyName: string; gstin: string; address: string; invoicePrefix: string; paymentTermsDays: number; footer: string; invoiceTemplate: string; emailSubject: string; emailBody: string; smtpHost: string; smtpPort: number; smtpFrom: string; logRetentionDays: number; logoDataUrl: string; stampDataUrl: string; signatureDataUrl: string; updatedAt: string };
export type TenantSettingsInput = Omit<TenantSettings, 'updatedAt'>;
export type OperationalLog = { id: string; kind: 'feature-flow' | 'error'; message: string; createdAt: string };

type TenantSeed = { id: string; name: string; adminEmail: string; userEmail: string };
type TenantFilters = { query?: string; status?: TenantStatus | 'all'; page?: number; pageSize?: number };
type TenantInput = { name: string };
type TenantUpdate = { name?: string; status?: TenantStatus };

const tenantSeeds: TenantSeed[] = [
  { id: 'nexio', name: 'Nexio Hyper', adminEmail: 'Admin@nexio.com', userEmail: 'user@nexio.com' },
  { id: 'maasp', name: 'MAASP Associates', adminEmail: 'Admin@maasp.com', userEmail: 'user@massp.com' },
  { id: 'evo', name: 'Evo Fitness', adminEmail: 'Admin@evo.com', userEmail: 'user@evo.com' },
  { id: 'gripdata', name: 'Gripdata Analytics', adminEmail: 'Admin@gripdata.com', userEmail: 'user@gripdata.com' },
  { id: 'od', name: 'OD Badminton', adminEmail: 'Admin@od.com', userEmail: 'user@od.com' },
];

function now() { return new Date().toISOString(); }
function seed(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')), created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'user')), password TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'disabled')));
    CREATE TABLE IF NOT EXISTS tenant_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), monthly_minor INTEGER NOT NULL, quarterly_minor INTEGER NOT NULL, half_yearly_minor INTEGER NOT NULL, annual_minor INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, name));
    CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), quote_number TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT, status TEXT NOT NULL CHECK(status IN ('draft')), total_minor INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id, quote_number));
    CREATE TABLE IF NOT EXISTS quotation_lines (id TEXT PRIMARY KEY, quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE, service_id TEXT NOT NULL, service_name TEXT NOT NULL, frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')), quantity INTEGER NOT NULL, unit_price_minor INTEGER NOT NULL, line_total_minor INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, gstin TEXT NOT NULL, billing_address TEXT NOT NULL, invoice_delivery TEXT NOT NULL CHECK(invoice_delivery IN ('monthly', 'quarterly', 'email', 'manual')), status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_lifecycle_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), action TEXT NOT NULL CHECK(action IN ('created', 'updated', 'disabled', 'enabled')), detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), company_name TEXT NOT NULL, gstin TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', invoice_prefix TEXT NOT NULL, payment_terms_days INTEGER NOT NULL, footer TEXT NOT NULL DEFAULT '', invoice_template TEXT NOT NULL, email_subject TEXT NOT NULL, email_body TEXT NOT NULL, smtp_host TEXT NOT NULL DEFAULT '', smtp_port INTEGER NOT NULL DEFAULT 587, smtp_from TEXT NOT NULL DEFAULT '', log_retention_days INTEGER NOT NULL DEFAULT 30, logo_data_url TEXT NOT NULL DEFAULT '', stamp_data_url TEXT NOT NULL DEFAULT '', signature_data_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operational_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL CHECK(kind IN ('feature-flow', 'error')), message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, value_minor INTEGER NOT NULL, payment_terms_days INTEGER NOT NULL, billing_frequency TEXT NOT NULL CHECK(billing_frequency IN ('monthly', 'quarterly', 'halfYearly', 'annual')), invoice_months TEXT NOT NULL, cycle_day INTEGER NOT NULL, escalation_percent REAL NOT NULL, escalation_review_date TEXT, renewal_notice_days INTEGER NOT NULL, security_deposit_minor INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'inactive')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contract_services (contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id), PRIMARY KEY(contract_id, service_id));
    CREATE TABLE IF NOT EXISTS security_deposits (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), contract_id TEXT NOT NULL REFERENCES contracts(id), customer_id TEXT NOT NULL REFERENCES customers(id), amount_minor INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('held', 'settled')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contract_audit_events (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, action TEXT NOT NULL, detail TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS additional_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id), contract_id TEXT NOT NULL REFERENCES contracts(id), service_date TEXT NOT NULL, description TEXT NOT NULL, price_minor INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active', 'archived')), billed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  for (const statement of ["ALTER TABLE tenants ADD COLUMN created_at TEXT NOT NULL DEFAULT ''", "ALTER TABLE tenants ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"]) { try { database.exec(statement); } catch { /* Existing database. */ } }

  const tenantCount = database.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (tenantCount.count > 0) { seedSettings(database); return; }

  database.exec('BEGIN');
  try {
    database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run('superadmin', null, 'Demo Superadmin', 'superadmin@ledgerly.demo', 'superadmin', 'admin123', 'active');
    const timestamp = now();
    const insertTenant = database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertUser = database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertRecord = database.prepare('INSERT INTO tenant_records (id, tenant_id, label) VALUES (?, ?, ?)');
    const insertCustomer = database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, billing_address, invoice_delivery, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertService = database.prepare('INSERT INTO services (id, tenant_id, name, description, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const tenant of tenantSeeds) {
      insertTenant.run(tenant.id, tenant.name, 'active', timestamp, timestamp);
      insertUser.run(`${tenant.id}-admin`, tenant.id, `${tenant.name} Admin`, tenant.adminEmail, 'admin', 'admin123', 'active');
      insertUser.run(`${tenant.id}-user`, tenant.id, `${tenant.name} User`, tenant.userEmail, 'user', 'admin123', 'active');
      insertRecord.run(`${tenant.id}-baseline`, tenant.id, `${tenant.name} baseline demo record`);
      const now = '2026-10-01T09:00:00.000Z';
      insertCustomer.run(`${tenant.id}-customer`, tenant.id, `${tenant.name} Customer`, 'Billing Contact', `billing@${tenant.id}.example`, '+91 90000 00000', '29ABCDE1234F1Z5', 'Demo billing address, Bengaluru', 'monthly', 'active', now, now);
      insertService.run(`${tenant.id}-service`, tenant.id, 'Managed billing service', 'Seeded recurring billing service', 'active', 100000, 280000, 540000, 1000000, now, now);
    }
    database.exec('COMMIT');
    seedSettings(database);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function seedSettings(database: DatabaseSync) { const rows = database.prepare('SELECT id, name FROM tenants').all() as Array<{ id: string; name: string }>; const insert = database.prepare(`INSERT OR IGNORE INTO tenant_settings (tenant_id, company_name, gstin, address, invoice_prefix, payment_terms_days, footer, invoice_template, email_subject, email_body, smtp_host, smtp_port, smtp_from, log_retention_days, logo_data_url, stamp_data_url, signature_data_url, updated_at) VALUES (?, ?, '', '', ?, 14, 'Thank you for your business.', 'Invoice {{invoiceNumber}} for {{customerName}}', 'Your invoice {{invoiceNumber}}', 'Hello {{customerName}}, please find your invoice attached.', '', 587, '', 30, '', '', '', ?)`); for (const row of rows) insert.run(row.id, row.name, row.name.slice(0, 3).toUpperCase(), '2026-10-01T09:00:00.000Z'); }

function customerFromRow(row: Record<string, unknown>): CustomerRecord { return { id: String(row.id), tenantId: String(row.tenant_id), companyName: String(row.company_name), contactName: String(row.contact_name), email: String(row.email), phone: String(row.phone), gstin: String(row.gstin), billingAddress: String(row.billing_address), invoiceDelivery: row.invoice_delivery as InvoiceDelivery, status: row.status as CustomerStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function customerError(input: CustomerInput) { if (!input.companyName.trim()) return 'Company name is required.'; if (!input.contactName.trim()) return 'Contact name is required.'; if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return 'Enter a valid email address.'; if (!input.phone.trim()) return 'Phone is required.'; if (!input.billingAddress.trim()) return 'Billing address is required.'; return null; }

function contractFromRow(database: DatabaseSync, row: Record<string, unknown>): Contract {
  const serviceRows = database.prepare('SELECT services.id, services.name FROM contract_services JOIN services ON services.id = contract_services.service_id WHERE contract_services.contract_id = ? ORDER BY services.name').all(String(row.id)) as Array<{ id: string; name: string }>;
  return { id: String(row.id), tenantId: String(row.tenant_id), customerId: String(row.customer_id), customerName: String(row.customer_name), name: String(row.name), serviceIds: serviceRows.map((service) => service.id), services: serviceRows.map((service) => service.name), startDate: String(row.start_date), endDate: String(row.end_date), valueMinor: Number(row.value_minor), paymentTermsDays: Number(row.payment_terms_days), billingFrequency: row.billing_frequency as BillingFrequency, invoiceMonths: JSON.parse(String(row.invoice_months)) as number[], cycleDay: Number(row.cycle_day), escalationPercent: Number(row.escalation_percent), escalationReviewDate: row.escalation_review_date ? String(row.escalation_review_date) : null, renewalNoticeDays: Number(row.renewal_notice_days), securityDepositMinor: Number(row.security_deposit_minor), status: row.status as ContractStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function additionalServiceFromRow(row: Record<string, unknown>): AdditionalService {
  return { id: String(row.id), tenantId: String(row.tenant_id), customerId: String(row.customer_id), customerName: String(row.customer_name), contractId: String(row.contract_id), contractName: String(row.contract_name), serviceDate: String(row.service_date), description: String(row.description), priceMinor: Number(row.price_minor), notes: String(row.notes), status: row.status as AdditionalServiceStatus, billedAt: row.billed_at ? String(row.billed_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function validateAdditionalServiceInput(input: AdditionalServiceInput) {
  if (!input.customerId || !input.contractId) throw new Error('Choose a customer and contract.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) throw new Error('Enter a valid service date.');
  if (!input.description.trim()) throw new Error('A service description is required.');
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('The customized price must be a non-negative whole minor unit.');
}
function validateContractInput(input: ContractInput) {
  if (!input.name.trim()) throw new Error('Contract name is required.');
  if (!input.customerId) throw new Error('Choose a customer.');
  if (!input.serviceIds.length) throw new Error('Choose at least one service.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate < input.startDate) throw new Error('Enter a valid contract date range.');
  if (!Number.isInteger(input.valueMinor) || input.valueMinor < 0 || !Number.isInteger(input.securityDepositMinor) || input.securityDepositMinor < 0) throw new Error('Contract value and security deposit must be non-negative.');
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || !Number.isInteger(input.cycleDay) || input.cycleDay < 1 || input.cycleDay > 31 || !Number.isInteger(input.renewalNoticeDays) || input.renewalNoticeDays < 0 || !Number.isFinite(input.escalationPercent) || input.escalationPercent < 0) throw new Error('Enter valid billing, escalation, and renewal terms.');
  const requiredMonths: Record<BillingFrequency, number> = { monthly: 0, quarterly: 3, halfYearly: 2, annual: 1 };
  const months = [...new Set(input.invoiceMonths)].sort((a, b) => a - b);
  if (months.length !== requiredMonths[input.billingFrequency] || months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) throw new Error(`${input.billingFrequency === 'halfYearly' ? 'Half-yearly' : input.billingFrequency[0].toUpperCase() + input.billingFrequency.slice(1)} contracts require ${requiredMonths[input.billingFrequency]} invoice months.`);
}

function identityFromRow(row: Record<string, unknown> | undefined): DemoIdentity | null {
  if (!row) return null;
  return { id: String(row.id), name: String(row.name), email: String(row.email), role: row.role as AppRole, tenantId: row.tenant_id ? String(row.tenant_id) : null, tenantName: row.tenant_name ? String(row.tenant_name) : null };
}
function tenantFromRow(row: Record<string, unknown>): Tenant { return { id: String(row.id), name: String(row.name), status: row.status as TenantStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at), userCount: Number(row.user_count) }; }
function requireSuperadmin(session: AppSession) { if (session.role !== 'superadmin') throw new Error('Only a superadmin may manage tenants.'); }
function cleanTenantName(name: string) { const value = name.trim().replace(/\s+/g, ' '); if (value.length < 2 || value.length > 100) throw new Error('Tenant name must be between 2 and 100 characters.'); return value; }

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
function settingsFromRow(row: Record<string, unknown>): TenantSettings { return { companyName: String(row.company_name), gstin: String(row.gstin), address: String(row.address), invoicePrefix: String(row.invoice_prefix), paymentTermsDays: Number(row.payment_terms_days), footer: String(row.footer), invoiceTemplate: String(row.invoice_template), emailSubject: String(row.email_subject), emailBody: String(row.email_body), smtpHost: String(row.smtp_host), smtpPort: Number(row.smtp_port), smtpFrom: String(row.smtp_from), logRetentionDays: Number(row.log_retention_days), logoDataUrl: String(row.logo_data_url), stampDataUrl: String(row.stamp_data_url), signatureDataUrl: String(row.signature_data_url), updatedAt: String(row.updated_at) }; }
function validateSettings(input: TenantSettingsInput) { if (!input.companyName.trim()) return 'Company name is required.'; if (!input.invoicePrefix.trim()) return 'Invoice prefix is required.'; if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0) return 'Payment terms must be zero or more days.'; if (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65535) return 'SMTP port must be between 1 and 65535.'; if (!Number.isInteger(input.logRetentionDays) || input.logRetentionDays < 1 || input.logRetentionDays > 3650) return 'Log retention must be between 1 and 3650 days.'; return null; }

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
  function nextTenantId(name: string) { const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant'; let candidate = base; let suffix = 2; while (database.prepare('SELECT 1 FROM tenants WHERE id = ?').get(candidate)) candidate = `${base}-${suffix++}`; return candidate; }
  function event(tenantId: string, action: TenantHistoryEvent['action'], detail: string) { database.prepare('INSERT INTO tenant_lifecycle_events (id, tenant_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, action, detail, now()); }
  function getTenant(tenantId: string): Tenant { const row = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id WHERE tenants.id = ? GROUP BY tenants.id`).get(tenantId) as Record<string, unknown> | undefined; if (!row) throw new Error('Tenant was not found.'); return tenantFromRow(row); }

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
    listTenants(session: AppSession, filters: TenantFilters): TenantList {
      requireSuperadmin(session); const pageSize = Math.min(Math.max(Number(filters.pageSize) || 10, 5), 50); const page = Math.max(Number(filters.page) || 1, 1); const query = filters.query?.trim() ?? ''; const conditions: string[] = []; const values: Array<string | number> = [];
      if (query) { conditions.push('LOWER(tenants.name) LIKE ?'); values.push(`%${query.toLowerCase()}%`); } if (filters.status && filters.status !== 'all') { conditions.push('tenants.status = ?'); values.push(filters.status); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''; const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM tenants ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`SELECT tenants.id, tenants.name, tenants.status, tenants.created_at, tenants.updated_at, COUNT(users.id) AS user_count FROM tenants LEFT JOIN users ON users.tenant_id = tenants.id ${where} GROUP BY tenants.id ORDER BY tenants.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(tenantFromRow), total };
    },
    createTenant(session: AppSession, input: TenantInput): Tenant {
      requireSuperadmin(session); const name = cleanTenantName(input.name); if (database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); const tenantId = nextTenantId(name); const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(tenantId, name, 'active', timestamp, timestamp); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-admin`, tenantId, `${name} Admin`, `admin@${tenantId}.demo`, 'admin', 'admin123', 'active'); database.prepare('INSERT INTO users (id, tenant_id, name, email, role, password, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${tenantId}-user`, tenantId, `${name} User`, `user@${tenantId}.demo`, 'user', 'admin123', 'active'); event(tenantId, 'created', `Created ${name} with default admin and user.`); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      seedSettings(database); return getTenant(tenantId);
    },
    updateTenant(session: AppSession, tenantId: string, input: TenantUpdate): Tenant {
      requireSuperadmin(session); const current = getTenant(tenantId); const name = input.name === undefined ? current.name : cleanTenantName(input.name); const status = input.status ?? current.status; if (status !== 'active' && status !== 'disabled') throw new Error('Tenant status is invalid.'); if (name !== current.name && database.prepare('SELECT 1 FROM tenants WHERE LOWER(name) = LOWER(?)').get(name)) throw new Error('A tenant with that name already exists.'); database.exec('BEGIN');
      try { if (name !== current.name) event(tenantId, 'updated', `Renamed from ${current.name} to ${name}.`); if (status !== current.status) event(tenantId, status === 'disabled' ? 'disabled' : 'enabled', status === 'disabled' ? 'Tenant disabled.' : 'Tenant enabled.'); database.prepare('UPDATE tenants SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(name, status, now(), tenantId); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return getTenant(tenantId);
    },
    listTenantHistory(session: AppSession, tenantId: string): TenantHistoryEvent[] { requireSuperadmin(session); getTenant(tenantId); return (database.prepare('SELECT id, tenant_id, action, detail, occurred_at FROM tenant_lifecycle_events WHERE tenant_id = ? ORDER BY occurred_at, rowid').all(tenantId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), tenantId: String(row.tenant_id), action: row.action as TenantHistoryEvent['action'], detail: String(row.detail), occurredAt: String(row.occurred_at) })); },
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
    listContracts(session: AppSession, query: ContractQuery = {}): ContractList {
      requireTenantMember(session);
      const conditions = ['contracts.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); values.push(`%${query.search.trim().toLowerCase()}%`, `%${query.search.trim().toLowerCase()}%`); }
      if (query.status) { conditions.push('contracts.status = ?'); values.push(query.status); }
      if (query.customerId) { conditions.push('contracts.customer_id = ?'); values.push(query.customerId); }
      const where = conditions.join(' AND '); const total = (database.prepare(`SELECT COUNT(*) AS count FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${where} ORDER BY contracts.created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map((row) => contractFromRow(database, row)), total };
    },
    listAdditionalServices(session: AppSession, query: AdditionalServiceQuery = {}): AdditionalServiceList {
      requireTenantMember(session);
      const conditions = ['additional_services.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(additional_services.description) LIKE ? OR lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term, term); }
      if (query.customerId) { conditions.push('additional_services.customer_id = ?'); values.push(query.customerId); }
      if (query.contractId) { conditions.push('additional_services.contract_id = ?'); values.push(query.contractId); }
      if (query.status) { conditions.push('additional_services.status = ?'); values.push(query.status); }
      if (query.billingPeriod) { if (!/^\d{4}-\d{2}$/.test(query.billingPeriod)) throw new Error('Billing period must use YYYY-MM.'); conditions.push('additional_services.service_date LIKE ? AND additional_services.status = \'active\' AND additional_services.billed_at IS NULL'); values.push(`${query.billingPeriod}%`); }
      const where = conditions.join(' AND '); const joins = ' FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id ';
      const total = (database.prepare(`SELECT COUNT(*) AS count${joins}WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name${joins}WHERE ${where} ORDER BY additional_services.service_date DESC, additional_services.created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(additionalServiceFromRow), total };
    },
    createAdditionalService(session: AppSession, input: AdditionalServiceInput): AdditionalService {
      requireTenantMember(session); validateAdditionalServiceInput(input);
      const contract = database.prepare(`SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ? AND contracts.status = 'active' AND customers.status = 'active'`).get(input.contractId, input.customerId, session.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected active customer in your tenant.');
      const timestamp = now(); const id = `${session.tenantId}-additional-${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO additional_services (id, tenant_id, customer_id, contract_id, service_date, description, price_minor, notes, status, billed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`).run(id, session.tenantId, input.customerId, input.contractId, input.serviceDate, input.description.trim(), input.priceMinor, input.notes?.trim() ?? '', timestamp, timestamp);
      const row = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id WHERE additional_services.id = ? AND additional_services.tenant_id = ?`).get(id, session.tenantId) as Record<string, unknown>;
      return additionalServiceFromRow(row);
    },
    updateAdditionalService(session: AppSession, additionalServiceId: string, update: AdditionalServiceUpdate): AdditionalService {
      requireTenantMember(session);
      const existing = database.prepare('SELECT * FROM additional_services WHERE id = ? AND tenant_id = ?').get(additionalServiceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('Additional service not found.');
      if (existing.billed_at) throw new Error('A billed additional service cannot be changed.');
      const input: AdditionalServiceInput = { customerId: update.customerId ?? String(existing.customer_id), contractId: update.contractId ?? String(existing.contract_id), serviceDate: update.serviceDate ?? String(existing.service_date), description: update.description ?? String(existing.description), priceMinor: update.priceMinor ?? Number(existing.price_minor), notes: update.notes ?? String(existing.notes) };
      validateAdditionalServiceInput(input); const status = update.status ?? existing.status as AdditionalServiceStatus;
      if (status !== 'active' && status !== 'archived') throw new Error('Additional service status is invalid.');
      const contract = database.prepare(`SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ?`).get(input.contractId, input.customerId, session.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected customer in your tenant.');
      database.prepare('UPDATE additional_services SET customer_id=?, contract_id=?, service_date=?, description=?, price_minor=?, notes=?, status=?, updated_at=? WHERE id=? AND tenant_id=?').run(input.customerId, input.contractId, input.serviceDate, input.description.trim(), input.priceMinor, input.notes?.trim() ?? '', status, now(), additionalServiceId, session.tenantId);
      const row = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id WHERE additional_services.id = ? AND additional_services.tenant_id = ?`).get(additionalServiceId, session.tenantId) as Record<string, unknown>;
      return additionalServiceFromRow(row);
    },
    createContract(session: AppSession, input: ContractInput): Contract {
      requireTenantMember(session); validateContractInput(input);
      const customer = database.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND status = \'active\'').get(input.customerId, session.tenantId);
      if (!customer) throw new Error('The selected customer must belong to your tenant and be active.');
      const services = [...new Set(input.serviceIds)]; const serviceStatement = database.prepare('SELECT id FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\'');
      if (services.some((serviceId) => !serviceStatement.get(serviceId, session.tenantId))) throw new Error('Each contract service must belong to your tenant and be active.');
      const id = `${session.tenantId}-contract-${crypto.randomUUID()}`; const timestamp = now();
      database.exec('BEGIN');
      try {
        database.prepare('INSERT INTO contracts (id, tenant_id, customer_id, name, start_date, end_date, value_minor, payment_terms_days, billing_frequency, invoice_months, cycle_day, escalation_percent, escalation_review_date, renewal_notice_days, security_deposit_minor, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)').run(id, session.tenantId, input.customerId, input.name.trim(), input.startDate, input.endDate, input.valueMinor, input.paymentTermsDays, input.billingFrequency, JSON.stringify([...new Set(input.invoiceMonths)].sort((a, b) => a - b)), input.cycleDay, input.escalationPercent, input.escalationReviewDate || null, input.renewalNoticeDays, input.securityDepositMinor, timestamp, timestamp);
        const insertService = database.prepare('INSERT INTO contract_services (contract_id, service_id) VALUES (?, ?)'); for (const serviceId of services) insertService.run(id, serviceId);
        database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), id, 'created', 'Contract created.', timestamp);
        if (input.securityDepositMinor > 0) database.prepare('INSERT INTO security_deposits (id, tenant_id, contract_id, customer_id, amount_minor, status, created_at) VALUES (?, ?, ?, ?, ?, \'held\', ?)').run(crypto.randomUUID(), session.tenantId, id, input.customerId, input.securityDepositMinor, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      const row = database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ?').get(id) as Record<string, unknown>;
      return contractFromRow(database, row);
    },
    updateContract(session: AppSession, contractId: string, update: ContractUpdate): Contract {
      requireTenantMember(session);
      const existing = database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.tenant_id = ?').get(contractId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('This contract does not belong to your tenant.');
      const current = contractFromRow(database, existing); const input: ContractInput = { customerId: update.customerId ?? current.customerId, serviceIds: update.serviceIds ?? current.serviceIds, name: update.name ?? current.name, startDate: update.startDate ?? current.startDate, endDate: update.endDate ?? current.endDate, valueMinor: update.valueMinor ?? current.valueMinor, paymentTermsDays: update.paymentTermsDays ?? current.paymentTermsDays, billingFrequency: update.billingFrequency ?? current.billingFrequency, invoiceMonths: update.invoiceMonths ?? current.invoiceMonths, cycleDay: update.cycleDay ?? current.cycleDay, escalationPercent: update.escalationPercent ?? current.escalationPercent, escalationReviewDate: update.escalationReviewDate ?? (current.escalationReviewDate ?? ''), renewalNoticeDays: update.renewalNoticeDays ?? current.renewalNoticeDays, securityDepositMinor: update.securityDepositMinor ?? current.securityDepositMinor };
      validateContractInput(input); const status = update.status ?? current.status; if (status !== 'active' && status !== 'inactive') throw new Error('Invalid contract status.');
      const customer = database.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND status = \'active\'').get(input.customerId, session.tenantId); if (!customer) throw new Error('The selected customer must belong to your tenant and be active.');
      const services = [...new Set(input.serviceIds)]; const serviceStatement = database.prepare('SELECT id FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\''); if (services.some((serviceId) => !serviceStatement.get(serviceId, session.tenantId))) throw new Error('Each contract service must belong to your tenant and be active.');
      const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('UPDATE contracts SET customer_id=?, name=?, start_date=?, end_date=?, value_minor=?, payment_terms_days=?, billing_frequency=?, invoice_months=?, cycle_day=?, escalation_percent=?, escalation_review_date=?, renewal_notice_days=?, security_deposit_minor=?, status=?, updated_at=? WHERE id=? AND tenant_id=?').run(input.customerId, input.name.trim(), input.startDate, input.endDate, input.valueMinor, input.paymentTermsDays, input.billingFrequency, JSON.stringify([...new Set(input.invoiceMonths)].sort((a, b) => a - b)), input.cycleDay, input.escalationPercent, input.escalationReviewDate || null, input.renewalNoticeDays, input.securityDepositMinor, status, timestamp, contractId, session.tenantId); database.prepare('DELETE FROM contract_services WHERE contract_id = ?').run(contractId); const insertService = database.prepare('INSERT INTO contract_services (contract_id, service_id) VALUES (?, ?)'); for (const serviceId of services) insertService.run(contractId, serviceId); database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), contractId, 'updated', `Contract ${status}.`, timestamp); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return contractFromRow(database, database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ?').get(contractId) as Record<string, unknown>);
    },
    listSecurityDeposits(session: AppSession): SecurityDeposit[] {
      requireTenantMember(session); return (database.prepare('SELECT security_deposits.*, customers.company_name AS customer_name FROM security_deposits JOIN customers ON customers.id = security_deposits.customer_id WHERE security_deposits.tenant_id = ? ORDER BY security_deposits.created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), contractId: String(row.contract_id), customerId: String(row.customer_id), customerName: String(row.customer_name), amountMinor: Number(row.amount_minor), status: row.status as SecurityDeposit['status'], createdAt: String(row.created_at) }));
    },
    getTenantSettings(session: AppSession): TenantSettings { requireTenantAdmin(session); return settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>); },
    updateTenantSettings(session: AppSession, input: TenantSettingsInput): TenantSettings { requireTenantAdmin(session); const error = validateSettings(input); if (error) throw new Error(error); const timestamp = now(); database.prepare(`UPDATE tenant_settings SET company_name=?, gstin=?, address=?, invoice_prefix=?, payment_terms_days=?, footer=?, invoice_template=?, email_subject=?, email_body=?, smtp_host=?, smtp_port=?, smtp_from=?, log_retention_days=?, logo_data_url=?, stamp_data_url=?, signature_data_url=?, updated_at=? WHERE tenant_id=?`).run(input.companyName.trim(), input.gstin.trim(), input.address.trim(), input.invoicePrefix.trim().toUpperCase(), input.paymentTermsDays, input.footer.trim(), input.invoiceTemplate.trim(), input.emailSubject.trim(), input.emailBody.trim(), input.smtpHost.trim(), input.smtpPort, input.smtpFrom.trim(), input.logRetentionDays, input.logoDataUrl, input.stampDataUrl, input.signatureDataUrl, timestamp, session.tenantId); database.prepare('DELETE FROM operational_logs WHERE tenant_id = ? AND created_at < ?').run(session.tenantId, new Date(Date.now() - input.logRetentionDays * 86400000).toISOString()); database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', 'Tenant settings were updated.', timestamp); return this.getTenantSettings(session); },
    previewTenantTemplate(session: AppSession): string { const settings = this.getTenantSettings(session); return settings.invoiceTemplate.replaceAll('{{invoiceNumber}}', `${settings.invoicePrefix}-2026-001`).replaceAll('{{customerName}}', 'Acme Industries'); },
    testTenantSmtp(session: AppSession): string { const settings = this.getTenantSettings(session); const message = `SMTP test prepared for ${settings.smtpFrom || 'the configured sender'}; no external email was sent.`; database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', message, now()); return message; },
    listOperationalLogs(session: AppSession): OperationalLog[] { requireTenantAdmin(session); return (database.prepare('SELECT id, kind, message, created_at FROM operational_logs WHERE tenant_id = ? ORDER BY created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), kind: row.kind as OperationalLog['kind'], message: String(row.message), createdAt: String(row.created_at) })); },
    close() { database.close(); },
  };
}

let sharedStore: ReturnType<typeof createTenantStore> | undefined;
export function getTenantStore() {
  sharedStore ??= createTenantStore();
  return sharedStore;
}
