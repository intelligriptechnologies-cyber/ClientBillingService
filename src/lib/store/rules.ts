import { parseBillingState, parseGstin, parseHsnSac } from '../invoice-gst';
import type { BillingFrequency, CustomerInput, QuotationInput, QuotationLine, ServiceInput, ServiceUpdate, TenantService, TenantSettingsInput, TenantUser, TenantUserInput, TenantUserUpdate } from './types';

// Input rules for the ported store areas. Both drivers apply them before any SQL runs.

export function cleanTenantName(name: unknown) {
  if (typeof name !== 'string') throw new Error('Tenant name is required.');
  const value = name.trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 100) throw new Error('Tenant name must be between 2 and 100 characters.');
  return value;
}

/** The id a new tenant asks for. A taken id gets a numeric suffix. */
export function tenantIdBase(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant';
}

/** The settings row a new tenant starts with, as columns. */
export function defaultSettingsColumns(name: string) {
  return {
    company_name: name, invoice_prefix: name.slice(0, 3).toUpperCase(), payment_terms_days: 14, footer: 'Thank you for your business.',
    invoice_template: 'Invoice {{invoiceNumber}} for {{customerName}}', email_subject: 'Your invoice {{invoiceNumber}}', email_body: 'Hello {{customerName}}, please find your invoice attached.',
  };
}

/** The UTC half-open range of a `YYYY-MM` month, or null when the text is not one. */
export function monthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const index = match ? Number(match[2]) - 1 : -1;
  if (!match || index < 0 || index > 11) return null;
  return { start: new Date(Date.UTC(Number(match[1]), index, 1)).toISOString(), end: new Date(Date.UTC(Number(match[1]), index + 1, 1)).toISOString() };
}

export function newTenantUser(input: TenantUserInput) {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name || !email) throw new Error('A user name and email are required.');
  if (input.role !== 'admin' && input.role !== 'user') throw new Error('Choose an admin or user role.');
  return { name, email, role: input.role };
}

type Membership = Pick<TenantUser, 'name' | 'email' | 'role' | 'status'>;

/** The user after `update`, and whether the change takes away an active admin. */
export function updatedTenantUser(existing: Membership, update: TenantUserUpdate) {
  const name = update.name === undefined ? existing.name : update.name.trim();
  const email = update.email === undefined ? existing.email : update.email.trim();
  const role = update.role === undefined ? existing.role : update.role;
  const status = update.status === undefined ? existing.status : update.status;
  if (!name || !email) throw new Error('A user name and email are required.');
  if ((role !== 'admin' && role !== 'user') || (status !== 'active' && status !== 'disabled')) throw new Error('Invalid user role or status.');
  const removesActiveAdmin = existing.role === 'admin' && existing.status === 'active' && !(role === 'admin' && status === 'active');
  return { user: { name, email, role, status }, removesActiveAdmin };
}

export const LAST_ADMIN_MESSAGE = 'A tenant must keep at least one active admin.';
export const DUPLICATE_EMAIL_MESSAGE = 'A user with that email already exists.';
export const DUPLICATE_TENANT_MESSAGE = 'A tenant with that name already exists.';

export function validateSettings(input: TenantSettingsInput) {
  if (!input.companyName.trim()) return 'Company name is required.';
  if (!input.invoicePrefix.trim()) return 'Invoice prefix is required.';
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0) return 'Payment terms must be zero or more days.';
  if (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65535) return 'SMTP port must be between 1 and 65535.';
  if ((input.smtpUser !== undefined && typeof input.smtpUser !== 'string') || (input.smtpPassword !== undefined && typeof input.smtpPassword !== 'string')) return 'SMTP user and password must be text.';
  if (!Number.isInteger(input.logRetentionDays) || input.logRetentionDays < 1 || input.logRetentionDays > 3650) return 'Log retention must be between 1 and 3650 days.';
  return null;
}

/** The oldest log a tenant keeps after saving `logRetentionDays`. */
export function logRetentionCutoff(logRetentionDays: number) {
  return new Date(Date.now() - logRetentionDays * 86400000).toISOString();
}

export function previewTemplate(settings: { invoiceTemplate: string; invoicePrefix: string }) {
  return settings.invoiceTemplate.replaceAll('{{invoiceNumber}}', `${settings.invoicePrefix}-2026-001`).replaceAll('{{customerName}}', 'Acme Industries');
}

export function operationalErrorMessage(operation: string, cause: unknown) {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}\n${cause.stack ?? ''}` : String(cause);
  return `${operation}: ${detail}`;
}

/** The largest value an `integer` column holds. SQLite stores more; Postgres refuses it. */
const INT4_MAX = 2147483647;

export const DUPLICATE_SERVICE_MESSAGE = 'A service with that name already exists in this tenant.';

/** The columns a service save writes. Prices are minor units, so each must be a safe whole number. */
export function serviceFields(input: ServiceInput) {
  if (!input.name.trim()) throw new Error('A service name is required.');
  const hsnSac = parseHsnSac(input.hsnSac);
  for (const price of Object.values(input.prices)) if (!Number.isSafeInteger(price) || price < 0) throw new Error('Service prices must be non-negative whole minor units.');
  return { name: input.name.trim(), description: input.description?.trim() ?? '', hsnSac, prices: input.prices };
}

/** The service after `update`; what the update leaves out keeps its current value. */
export function updatedService(current: TenantService, update: ServiceUpdate) {
  const fields = serviceFields({ name: update.name ?? current.name, description: update.description ?? current.description, hsnSac: update.hsnSac ?? current.hsnSac, prices: update.prices ?? current.prices });
  const status = update.status ?? current.status;
  if (status !== 'active' && status !== 'inactive') throw new Error('Invalid service status.');
  return { ...fields, status };
}

/** The columns a customer save writes. A registered client's state comes from the GSTIN; an unregistered one keeps the billing state chosen. */
export function customerFields(input: CustomerInput) {
  if (!input.companyName.trim()) throw new Error('Company name is required.');
  if (!input.contactName.trim()) throw new Error('Contact name is required.');
  if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error('Enter a valid email address.');
  if (!input.phone.trim()) throw new Error('Phone is required.');
  if (!input.billingAddress.trim()) throw new Error('Billing address is required.');
  const registration = parseGstin(input.gstin, 'client GSTIN');
  const billingState = parseBillingState(input.stateCode);
  return {
    companyName: input.companyName.trim(), contactName: input.contactName.trim(), email: input.email.trim(), phone: input.phone.trim(),
    gstin: registration.gstin, stateCode: registration.gstin ? registration.stateCode : billingState, billingAddress: input.billingAddress.trim(), invoiceDelivery: input.invoiceDelivery,
  };
}

export const FOREIGN_QUOTATION_MESSAGE = 'This quotation does not belong to your tenant.';
export const QUOTATION_SERVICE_MESSAGE = 'A quotation service must belong to your tenant and be active.';
const billingFrequencies: readonly BillingFrequency[] = ['monthly', 'quarterly', 'halfYearly', 'annual'];

/** The customer a quotation is for. It needs a name and at least one line. */
export function quotationCustomer(customerName: string, customerEmail: string | null | undefined, lines: readonly unknown[]) {
  const name = customerName.trim();
  if (!name || !lines.length) throw new Error('Choose a customer name and at least one service.');
  return { customerName: name, customerEmail: customerEmail?.trim() || null };
}

export function checkQuotationLine(line: QuotationInput['lines'][number]) {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > INT4_MAX) throw new Error('Quotation quantities must be positive whole numbers.');
  if (!billingFrequencies.includes(line.frequency)) throw new Error('Choose a supported billing frequency.');
}

/** Line `index` of a quotation, priced from the service as it is now. */
export function pricedQuotationLine(quotationId: string, index: number, line: QuotationInput['lines'][number], service: TenantService): QuotationLine {
  const unitPriceMinor = service.prices[line.frequency];
  return { id: `${quotationId}-line-${index + 1}`, serviceId: line.serviceId, serviceName: service.name, frequency: line.frequency, quantity: line.quantity, unitPriceMinor, lineTotalMinor: unitPriceMinor * line.quantity };
}

export function quoteNumber(tenantId: string, sequence: number) {
  return `Q-${tenantId.toUpperCase()}-${String(sequence).padStart(4, '0')}`;
}

export function quotationTotal(lines: readonly QuotationLine[]) {
  return lines.reduce((total, line) => total + line.lineTotalMinor, 0);
}
