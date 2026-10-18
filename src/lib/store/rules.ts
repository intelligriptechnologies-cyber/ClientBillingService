import type { TenantSettingsInput, TenantUser, TenantUserInput, TenantUserUpdate } from './types';

// Input rules for the tenants, users and settings areas. Both drivers apply them before any SQL runs.

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
