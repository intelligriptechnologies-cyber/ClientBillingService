import { parseBillingState, parseGstin, parseHsnSac } from '../invoice-gst';
import type {
  AdditionalService, AdditionalServiceInput, AdditionalServiceUpdate, BillingFrequency, Contract, ContractInput, ContractUpdate, CustomerInput, DepositSettlementInput, QuotationInput, QuotationLine,
  RenewalList, RenewalQuery, RenewalRecord, RenewalStatus, SecurityDeposit, ServiceInput, ServiceUpdate, TaskNoteInput, TenantService, TenantSettingsInput, TenantUser, TenantUserInput, TenantUserUpdate,
} from './types';

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

/** A real `YYYY-MM-DD` day. Postgres refuses 2026-02-31 in a date column; SQLite would store it. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The half-open range of days in a `YYYY-MM` month, for date columns, or null when the text is not one. */
export function monthDays(month: string) {
  const range = monthRange(month);
  return range && { start: range.start.slice(0, 10), end: range.end.slice(0, 10) };
}

const isInt4 = (value: number, min: number) => Number.isInteger(value) && value >= min && value <= INT4_MAX;
const requiredInvoiceMonths: Record<BillingFrequency, number> = { monthly: 0, quarterly: 3, halfYearly: 2, annual: 1 };
export const CONTRACT_CUSTOMER_MESSAGE = 'The selected customer must belong to your tenant and be active.';
export const CONTRACT_SERVICE_MESSAGE = 'Each contract service must belong to your tenant and be active.';
export const FOREIGN_CONTRACT_MESSAGE = 'This contract does not belong to your tenant.';

/**
 * The columns a contract save writes. escalation_percent is numeric(6,3), so a rate needs at most three decimals
 * and must stay under 1000; otherwise Postgres would round or refuse what SQLite keeps exactly.
 */
export function contractFields(input: ContractInput) {
  if (!input.name.trim()) throw new Error('Contract name is required.');
  if (!input.customerId) throw new Error('Choose a customer.');
  if (!input.serviceIds.length) throw new Error('Choose at least one service.');
  if (!isCalendarDate(input.startDate) || !isCalendarDate(input.endDate) || input.endDate < input.startDate) throw new Error('Enter a valid contract date range.');
  if (!Number.isSafeInteger(input.valueMinor) || input.valueMinor < 0 || !Number.isSafeInteger(input.securityDepositMinor) || input.securityDepositMinor < 0) throw new Error('Contract value and security deposit must be non-negative.');
  const escalation = input.escalationPercent;
  if (!isInt4(input.paymentTermsDays, 0) || !Number.isInteger(input.cycleDay) || input.cycleDay < 1 || input.cycleDay > 31 || !isInt4(input.renewalNoticeDays, 0)
    || !Number.isFinite(escalation) || escalation < 0 || escalation >= 1000 || Math.round(escalation * 1000) / 1000 !== escalation) throw new Error('Enter valid billing, escalation, and renewal terms.');
  if (input.escalationReviewDate && !isCalendarDate(input.escalationReviewDate)) throw new Error('Enter a valid escalation review date.');
  const months = [...new Set(input.invoiceMonths)].sort((a, b) => a - b);
  const required = requiredInvoiceMonths[input.billingFrequency];
  if (months.length !== required || months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) throw new Error(`${input.billingFrequency === 'halfYearly' ? 'Half-yearly' : input.billingFrequency[0].toUpperCase() + input.billingFrequency.slice(1)} contracts require ${required} invoice months.`);
  return {
    customerId: input.customerId, serviceIds: [...new Set(input.serviceIds)], name: input.name.trim(), startDate: input.startDate, endDate: input.endDate, valueMinor: input.valueMinor,
    paymentTermsDays: input.paymentTermsDays, billingFrequency: input.billingFrequency, invoiceMonths: months, cycleDay: input.cycleDay, escalationPercent: escalation,
    escalationReviewDate: input.escalationReviewDate || null, renewalNoticeDays: input.renewalNoticeDays, securityDepositMinor: input.securityDepositMinor,
  };
}

/** The contract after `update`; what the update leaves out keeps its current value. */
export function updatedContract(current: Contract, update: ContractUpdate) {
  const fields = contractFields({
    customerId: update.customerId ?? current.customerId, serviceIds: update.serviceIds ?? current.serviceIds, name: update.name ?? current.name, startDate: update.startDate ?? current.startDate,
    endDate: update.endDate ?? current.endDate, valueMinor: update.valueMinor ?? current.valueMinor, paymentTermsDays: update.paymentTermsDays ?? current.paymentTermsDays,
    billingFrequency: update.billingFrequency ?? current.billingFrequency, invoiceMonths: update.invoiceMonths ?? current.invoiceMonths, cycleDay: update.cycleDay ?? current.cycleDay,
    escalationPercent: update.escalationPercent ?? current.escalationPercent, escalationReviewDate: update.escalationReviewDate ?? (current.escalationReviewDate ?? ''),
    renewalNoticeDays: update.renewalNoticeDays ?? current.renewalNoticeDays, securityDepositMinor: update.securityDepositMinor ?? current.securityDepositMinor,
  });
  const status = update.status ?? current.status;
  if (status !== 'active' && status !== 'inactive') throw new Error('Invalid contract status.');
  return { ...fields, status };
}

/** The renewal's end date and audit note. It must move the end date later than `currentEndDate`. */
export function renewal(currentEndDate: string, input: { endDate: string; note: string }) {
  if (!isCalendarDate(input.endDate) || input.endDate <= currentEndDate) throw new Error('The renewed end date must be later than the current end date.');
  return { endDate: input.endDate, note: input.note.trim() || 'Renewal recorded.' };
}

export function renewalRecord(contract: Contract, date = new Date()): RenewalRecord {
  return { contractId: contract.id, contractName: contract.name, customerName: contract.customerName, endDate: contract.endDate, valueMinor: contract.valueMinor, renewalNoticeDays: contract.renewalNoticeDays, renewalStatus: renewalStatusFor(contract, date), dueTiming: renewalDueTiming(contract.endDate, date), status: contract.status };
}

function renewalStatusFor(contract: Contract, date: Date): RenewalStatus {
  const today = date.toISOString().slice(0, 10);
  if (contract.endDate < today) return 'expired';
  const noticeDate = new Date(`${contract.endDate}T00:00:00Z`);
  noticeDate.setUTCDate(noticeDate.getUTCDate() - contract.renewalNoticeDays);
  return noticeDate.toISOString().slice(0, 10) <= today ? 'upcoming' : 'current';
}

function renewalDueTiming(endDate: string, date: Date) {
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - today) / 86400000);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days} days`;
}

/** Renewals are worked out in code from every contract, then filtered and paged. */
export function renewalPage(contracts: Contract[], query: RenewalQuery): RenewalList {
  const filtered = contracts.map((contract) => renewalRecord(contract)).filter((record) => (!query.status || record.renewalStatus === query.status) && (!query.month || record.endDate.startsWith(query.month)));
  const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
}

export const FOREIGN_DEPOSIT_MESSAGE = 'This security deposit does not belong to your tenant.';

/** The deposit after settling `input` against what is already settled, or the reason it cannot be. */
export function settlement(deposit: { amountMinor: number; settledMinor: number; status: SecurityDeposit['status'] }, input: DepositSettlementInput) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Settlement amount must be a positive whole minor-unit value.');
  if (deposit.settledMinor >= deposit.amountMinor || deposit.status === 'settled') throw new Error('This security deposit has already been settled.');
  if (input.amountMinor > deposit.amountMinor - deposit.settledMinor) throw new Error('Settlement cannot exceed the held deposit balance.');
  const settledMinor = deposit.settledMinor + input.amountMinor;
  return { settledMinor, status: settledMinor === deposit.amountMinor ? 'settled' as const : 'held' as const, note: input.note.trim() || 'Customer closeout settlement.' };
}

export function checkTaskNote(input: TaskNoteInput): void {
  if (!input || typeof input.customerId !== 'string' || !input.customerId) throw new Error('Choose a customer.');
  if (!isCalendarDate(input.date)) throw new Error('Choose a valid date.');
  if (typeof input.note !== 'string' || !input.note.trim()) throw new Error('Note is required.');
}

export const TASK_NOTE_NOT_FOUND = 'Task note not found.';
export const TASK_NOTE_CUSTOMER_MESSAGE = 'The selected customer does not belong to your tenant.';

export function additionalServiceFields(input: AdditionalServiceInput) {
  if (!input.customerId || !input.contractId) throw new Error('Choose a customer and contract.');
  if (!isCalendarDate(input.serviceDate)) throw new Error('Enter a valid service date.');
  if (!input.description.trim()) throw new Error('A service description is required.');
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('The customized price must be a non-negative whole minor unit.');
  return { customerId: input.customerId, contractId: input.contractId, serviceDate: input.serviceDate, description: input.description.trim(), priceMinor: input.priceMinor, notes: input.notes?.trim() ?? '' };
}

/** The additional service after `update`. A billed one is part of an invoice and cannot change. */
export function updatedAdditionalService(current: AdditionalService, update: AdditionalServiceUpdate) {
  if (current.billedAt) throw new Error('A billed additional service cannot be changed.');
  const fields = additionalServiceFields({ customerId: update.customerId ?? current.customerId, contractId: update.contractId ?? current.contractId, serviceDate: update.serviceDate ?? current.serviceDate, description: update.description ?? current.description, priceMinor: update.priceMinor ?? current.priceMinor, notes: update.notes ?? current.notes });
  const status = update.status ?? current.status;
  if (status !== 'active' && status !== 'archived') throw new Error('Additional service status is invalid.');
  return { ...fields, status };
}

export function checkBillingPeriod(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Billing period must use YYYY-MM.');
}
