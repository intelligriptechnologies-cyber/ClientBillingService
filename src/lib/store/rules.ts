import { gstr1Section, validateGstin } from '../gst';
import type { SnapshotFormat } from '../invoice-format';
import { amountOnlyLine, gstSnapshotFields, parseBillingState, parseGstin, parseHsnSac, resolveSupply, sellerRegisteredIn, type GstSnapshotFields, type SupplyContext } from '../invoice-gst';
import { calculateInvoiceLines } from '../invoice-lines';
import type {
  AdditionalService, AdditionalServiceInput, AdditionalServiceUpdate, BillingFrequency, BulkInvoiceAdditionalLine, BulkInvoicePreview, BulkInvoiceProposal, BulkInvoiceSkip, Contract, ContractInput,
  ContractUpdate, CustomerInput, CustomerRecord, DeliveryStatus, DepositSettlementInput, GstSalesReport, GstSalesRow, HsnSummaryRow, InvoiceInput, InvoiceSnapshot, InvoiceStatus, PaymentInput,
  PaymentMethod, PaymentReminder, PendingPayment, QuotationInput, QuotationLine, RenewalList, RenewalQuery, RenewalRecord, RenewalStatus, SecurityDeposit, ServiceInput, ServiceUpdate, TaskNoteInput,
  TenantInvoice, TenantPayment, TenantService, TenantSettings, TenantSettingsInput, TenantUser, TenantUserInput, TenantUserUpdate,
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
/** The tenant log row written for each users row that first-arrival binding gives an Authelia username. */
export function bindingLogMessage(username: string, userId: string) { return `First arrival bound Authelia user ${username} to user ${userId}.`; }
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

export const INVOICE_NOT_FOUND = 'Invoice not found.';
export const INVOICE_CONTRACT_MESSAGE = 'The selected contract must belong to your tenant.';
export const INVOICE_CUSTOMER_MESSAGE = 'The selected customer must belong to your tenant.';

/** An issued invoice's number: the tenant prefix and the invoice's place among the tenant's invoices, counted from 1. */
export function invoiceNumber(prefix: string, sequence: number) {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export type InvoiceAmounts = ReturnType<typeof invoiceAmounts>;

/**
 * The checks an invoice request needs no database for, and its amounts. Dates must be real days, money safe whole
 * minor units, and a typed GST rate at most three decimals, because gst_rate is numeric(6,3).
 */
export function invoiceAmounts(input: InvoiceInput) {
  if (!isCalendarDate(input.invoiceDate) || !isCalendarDate(input.dueDate) || input.dueDate < input.invoiceDate) throw new Error('Enter valid invoice and due dates.');
  const totals = input.lines ? calculateInvoiceLines(input.lines) : null;
  if (!totals && (!Number.isSafeInteger(input.taxableMinor) || (input.taxableMinor ?? -1) < 0)) throw new Error('Taxable amount must be a non-negative whole minor amount.');
  const gstRate = totals ? (totals.taxableMinor ? Math.round(totals.gstMinor / totals.taxableMinor * 10000) / 100 : 0) : input.gstRate ?? 0;
  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100 || Math.round(gstRate * 1000) / 1000 !== gstRate) throw new Error('GST rate must be between 0 and 100, with at most three decimals.');
  if (input.gstApplicable === false && totals?.gstMinor) throw new Error('Turn on GST applicable before adding taxed lines.');
  if (input.customerPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.customerPan.trim().toUpperCase())) throw new Error('Enter a valid customer PAN.');
  const taxableMinor = totals?.taxableMinor ?? input.taxableMinor!;
  const gstMinor = totals?.gstMinor ?? Math.round(taxableMinor * gstRate / 100);
  if (!Number.isSafeInteger(taxableMinor + gstMinor)) throw new Error('The invoice total is too large.');
  return { lines: totals?.lines, gstRate, taxableMinor, gstMinor, totalMinor: taxableMinor + gstMinor };
}

/** The state a client supplies to: the typed GSTIN when it differs from the stored one, otherwise what the client record holds. */
export function clientForSupply(customer: CustomerRecord | null, typedGstin: string | undefined, billingStateCode?: string) {
  const stored = customer ? customer.gstin.trim().toUpperCase() : '';
  const typed = typedGstin?.trim().toUpperCase() ?? '';
  const storedState = customer ? customer.stateCode : parseBillingState(billingStateCode);
  if (!typed || typed === stored) return { gstin: stored, stateCode: storedState };
  const registration = parseGstin(typed, 'customer GST number');
  return { gstin: registration.gstin, stateCode: registration.gstin ? registration.stateCode : storedState };
}

export type InvoiceTax = { supply: SupplyContext; gstFields: GstSnapshotFields };

/** Where the invoice's tax lands and the GST fields it keeps. Every GST rule, the unregistered-seller rule among them, comes from invoice-gst. */
export function invoiceTax(input: InvoiceInput, amounts: InvoiceAmounts, seller: TenantSettings, customer: CustomerRecord): InvoiceTax {
  const supply = resolveSupply(seller.stateCode, clientForSupply(customer, input.customerGstin));
  const lines = amounts.lines ?? [amountOnlyLine(supply, amounts.gstRate)];
  return { supply, gstFields: gstSnapshotFields({ seller, supply, lines, requireHsn: Boolean(amounts.lines), overrideReason: input.taxSplitOverrideReason }) };
}

/** What an issued invoice prints, so later edits to the seller, the client or the format never change it. */
export function issuedInvoiceSnapshot(input: InvoiceInput, amounts: InvoiceAmounts, seller: TenantSettings, customer: CustomerRecord, tax: InvoiceTax, format: SnapshotFormat): InvoiceSnapshot {
  return {
    companyName: seller.companyName, gstin: seller.gstin, address: seller.address, logoDataUrl: seller.logoDataUrl, stampDataUrl: seller.stampDataUrl, signatureDataUrl: seller.signatureDataUrl,
    customerName: customer.companyName, customerEmail: customer.email, customerAddress: input.billingAddress?.trim() || customer.billingAddress, customerPan: input.customerPan?.trim().toUpperCase() || undefined,
    customerGstin: input.customerGstin?.trim().toUpperCase() || customer.gstin, venue: input.venue?.trim(), gstApplicable: tax.supply.sellerRegistered && (input.gstApplicable ?? amounts.gstMinor > 0),
    notes: input.notes?.trim(), lines: amounts.lines, gstRate: amounts.gstRate, footer: seller.footer, invoiceTemplate: seller.invoiceTemplate, format, ...tax.gstFields,
  };
}

/** The reason a void needs, once the invoice is known to be unpaid and not void already. */
export function voidReason(invoice: TenantInvoice | null, reason: string) {
  if (!invoice) throw new Error(INVOICE_NOT_FOUND);
  if (invoice.status === 'void') throw new Error('This invoice is already void.');
  if (invoice.paidMinor > 0) throw new Error('An invoice with recorded payments cannot be voided.');
  if (!reason.trim()) throw new Error('Enter a reason for voiding the invoice.');
  return reason.trim();
}

/** The reason a correction needs, once the invoice is known to be unpaid and not void. */
export function correctionReason(invoice: TenantInvoice | null, reason: string): string {
  if (!invoice) throw new Error(INVOICE_NOT_FOUND);
  if (invoice.status === 'void') throw new Error('A void invoice cannot be corrected.');
  if (invoice.paidMinor > 0) throw new Error('An invoice with recorded payments cannot be corrected.');
  if (!reason.trim()) throw new Error('Enter a correction reason.');
  return reason.trim();
}

/** The replacement's request: the correction, with the original's contract, customer and printed details for what it leaves out. `formatId` is the original's format while it still exists. */
export function replacementInput(current: TenantInvoice, correction: InvoiceInput, formatId: string | undefined): InvoiceInput {
  const kept = current.snapshot;
  return {
    ...correction, contractId: current.contractId ?? undefined, customerId: current.customerId, venue: correction.venue ?? kept.venue, customerPan: correction.customerPan ?? kept.customerPan,
    customerGstin: correction.customerGstin ?? kept.customerGstin, billingAddress: correction.billingAddress ?? kept.customerAddress, gstApplicable: correction.gstApplicable ?? kept.gstApplicable,
    notes: correction.notes ?? kept.notes, formatId: correction.formatId ?? formatId,
  };
}

/** A real `YYYY-MM` month as a half-open range of days. The bulk run refuses anything else before it reads a row. */
export function billingPeriodDays(period: string) {
  const days = /^\d{4}-\d{2}$/.test(period) ? monthDays(period) : null;
  if (!days) throw new Error('Billing period must use YYYY-MM.');
  return days;
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export type BulkAddition = BulkInvoiceAdditionalLine & { contractId: string };

/**
 * The invoices a run for `billingPeriod` would issue and the contracts it skips, in the order of `contracts`.
 * `additions` are the period's unbilled active additional services, `invoiced` the contracts already invoiced in it.
 */
export function bulkInvoicePreview(billingPeriod: string, contracts: readonly Contract[], additions: readonly BulkAddition[], invoiced: ReadonlySet<string>, sellerStateCode: string): BulkInvoicePreview {
  const days = billingPeriodDays(billingPeriod);
  const month = Number(billingPeriod.slice(5));
  const gstRate = sellerRegisteredIn(sellerStateCode) ? 18 : 0;
  const proposed: BulkInvoiceProposal[] = []; const skipped: BulkInvoiceSkip[] = [];
  for (const contract of contracts) {
    const common = { contractId: contract.id, contractName: contract.name, customerName: contract.customerName };
    if (contract.status !== 'active') { skipped.push({ ...common, reason: 'Contract is inactive.' }); continue; }
    if (contract.startDate >= days.end || contract.endDate < days.start) { skipped.push({ ...common, reason: 'Contract is outside this billing period.' }); continue; }
    if (contract.billingFrequency !== 'monthly' && !contract.invoiceMonths.includes(month)) { skipped.push({ ...common, reason: `Billing is not scheduled for ${new Date(`${days.start}T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}.` }); continue; }
    if (invoiced.has(contract.id)) { skipped.push({ ...common, reason: 'An invoice already exists for this contract and period.' }); continue; }
    const additionalLines = additions.filter((line) => line.contractId === contract.id).map(({ id, description, priceMinor, serviceDate }) => ({ id, description, priceMinor, serviceDate }));
    const taxableMinor = contract.valueMinor + additionalLines.reduce((total, line) => total + line.priceMinor, 0);
    const gstMinor = Math.round(taxableMinor * gstRate / 100);
    proposed.push({ ...common, customerId: contract.customerId, billingPeriod, invoiceDate: days.start, dueDate: addCalendarDays(days.start, contract.paymentTermsDays), taxableMinor, gstRate, gstMinor, totalMinor: taxableMinor + gstMinor, additionalLines });
  }
  return { billingPeriod, proposed, skipped };
}

/** What a bulk-issued invoice prints: the contract amount on one amount-only line, taxed by the place of supply. */
export function bulkInvoiceSnapshot(proposal: BulkInvoiceProposal, seller: TenantSettings, customer: CustomerRecord, format: SnapshotFormat): InvoiceSnapshot {
  const supply = resolveSupply(seller.stateCode, { gstin: customer.gstin, stateCode: customer.stateCode });
  const gstFields = gstSnapshotFields({ seller, supply, lines: [amountOnlyLine(supply, proposal.gstRate)], requireHsn: false });
  return {
    companyName: seller.companyName, gstin: seller.gstin, address: seller.address, logoDataUrl: seller.logoDataUrl, stampDataUrl: seller.stampDataUrl, signatureDataUrl: seller.signatureDataUrl,
    customerName: customer.companyName, customerEmail: customer.email, customerAddress: customer.billingAddress, customerGstin: customer.gstin, gstRate: proposal.gstRate, footer: seller.footer,
    invoiceTemplate: seller.invoiceTemplate, format, ...gstFields,
  };
}

export function bulkRunMessage(billingPeriod: string, generatedCount: number, skippedCount: number) {
  return `Bulk invoice run for ${billingPeriod} issued ${generatedCount} invoice(s); ${skippedCount} contract(s) skipped.`;
}

/** A real `YYYY-MM` report month as a half-open range of days. */
export function reportMonthDays(month: string) {
  const days = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? monthDays(month) : null;
  if (!days) throw new Error('Choose a valid report month.');
  return days;
}

function gstState(gstin: string) { return /^\d{2}/.test(gstin.trim()) ? gstin.trim().slice(0, 2) : null; }

/** One invoice in the GST register. `customerGstin` is the client's GSTIN now, for invoices whose snapshot predates keeping it. */
function gstSalesRow(invoice: TenantInvoice, customerGstin: string, companyGstin: string): GstSalesRow {
  const { snapshot, gstMinor, totalMinor } = invoice;
  const gstin = snapshot.customerGstin ?? customerGstin;
  const interstate = snapshot.taxSplit ? snapshot.taxSplit === 'inter' : Boolean(gstState(companyGstin) && gstState(gstin) && gstState(companyGstin) !== gstState(gstin));
  const igstMinor = snapshot.lines?.length ? snapshot.lines.filter((line) => line.taxType === 'igst').reduce((sum, line) => sum + line.gstMinor, 0) : interstate ? gstMinor : 0;
  const domesticGstMinor = gstMinor - igstMinor;
  const cgstMinor = Math.floor(domesticGstMinor / 2); const sgstMinor = domesticGstMinor - cgstMinor;
  const taxable = snapshot.documentType ? snapshot.documentType === 'Tax Invoice' : gstMinor > 0;
  const registration = validateGstin(gstin);
  const section = gstr1Section({ taxability: taxable ? 'taxable' : 'nil', clientRegistered: registration.ok && registration.registered, split: interstate ? 'inter' : 'intra', invoiceTotalMinor: totalMinor });
  return { section, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, customerName: invoice.customerName, customerGstin: gstin, taxableMinor: invoice.taxableMinor, gstMinor, totalMinor, igstMinor, cgstMinor, sgstMinor, netGstMinor: gstMinor };
}

/** One row per HSN/SAC code across the month's lines. Lines without a code (older invoices, optional codes) are left out. */
function hsnSummary(invoices: readonly TenantInvoice[]): HsnSummaryRow[] {
  const byCode = new Map<string, HsnSummaryRow>();
  for (const line of invoices.flatMap((invoice) => invoice.snapshot.lines ?? [])) {
    if (!line.hsnSac) continue;
    const current = byCode.get(line.hsnSac) ?? { hsn: line.hsnSac, description: line.description, quantity: 0, taxableMinor: 0, taxMinor: 0 };
    byCode.set(line.hsnSac, { ...current, quantity: Math.round((current.quantity + line.quantity) * 1000) / 1000, taxableMinor: current.taxableMinor + line.amountMinor, taxMinor: current.taxMinor + line.gstMinor });
  }
  return [...byCode.values()].sort((a, b) => a.hsn.localeCompare(b.hsn));
}

/** The GST register for `month` from its non-void invoices in register order, each with its client's GSTIN now. */
export function gstSalesReport(month: string, seller: TenantSettings, invoices: ReadonlyArray<{ invoice: TenantInvoice; customerGstin: string }>): GstSalesReport {
  const items = invoices.map(({ invoice, customerGstin }) => gstSalesRow(invoice, customerGstin, seller.gstin));
  const totals = items.reduce((total, item) => ({ taxableMinor: total.taxableMinor + item.taxableMinor, gstMinor: total.gstMinor + item.gstMinor, totalMinor: total.totalMinor + item.totalMinor, igstMinor: total.igstMinor + item.igstMinor, cgstMinor: total.cgstMinor + item.cgstMinor, sgstMinor: total.sgstMinor + item.sgstMinor, netGstMinor: total.netGstMinor + item.netGstMinor }), { taxableMinor: 0, gstMinor: 0, totalMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, netGstMinor: 0 });
  return { month, companyName: seller.companyName, gstin: seller.gstin, items, hsnSummary: hsnSummary(invoices.map(({ invoice }) => invoice)), totals };
}

const deliveryStatuses: readonly DeliveryStatus[] = ['sent', 'failed', 'not-configured'];
export function checkDeliveryStatus(status: DeliveryStatus) {
  if (!deliveryStatuses.includes(status)) throw new Error('Unknown delivery status.');
}

export const paymentMethods = ['bank_transfer', 'cash', 'card', 'cheque', 'other'] as const satisfies readonly PaymentMethod[];
export const FOREIGN_PAYMENT_INVOICE_MESSAGE = 'This invoice does not belong to your tenant.';

/** What a payment applies to its invoice: the payment, TDS and write-off together, each a safe whole minor amount. */
export function paymentApplied(input: PaymentInput) {
  if (!isCalendarDate(input.paymentDate)) throw new Error('Enter a valid payment date.');
  for (const value of [input.amountMinor, input.tdsMinor, input.writeOffMinor]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Payment, TDS, and write-off values must be non-negative whole minor amounts.');
  const appliedMinor = input.amountMinor + input.tdsMinor + input.writeOffMinor;
  if (appliedMinor <= 0) throw new Error('Enter a payment, TDS, or write-off amount.');
  if (!(paymentMethods as readonly string[]).includes(input.method)) throw new Error('Choose a valid payment method.');
  return appliedMinor;
}

type Balance = Pick<TenantInvoice, 'status' | 'totalMinor' | 'paidMinor'>;

/** The invoice's paid amount and status once `appliedMinor` lands on it, or the reason it cannot. */
export function allocation(invoice: Balance | null, appliedMinor: number): { paidMinor: number; status: InvoiceStatus } {
  if (!invoice) throw new Error(FOREIGN_PAYMENT_INVOICE_MESSAGE);
  if (invoice.status === 'void' || invoice.status === 'paid') throw new Error('Payments can only be allocated to an outstanding invoice.');
  if (appliedMinor > invoice.totalMinor - invoice.paidMinor) throw new Error('Allocation cannot exceed the outstanding invoice balance.');
  const paidMinor = invoice.paidMinor + appliedMinor;
  return { paidMinor, status: paidMinor === invoice.totalMinor ? 'paid' : 'partial' };
}

/** The write-off that closes an outstanding invoice from pending payments. */
export function closeout(invoice: Balance | null, note: string, today = new Date().toISOString().slice(0, 10)): Omit<PaymentInput, 'invoiceId'> {
  if (!invoice) throw new Error(FOREIGN_PAYMENT_INVOICE_MESSAGE);
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  if (outstanding <= 0 || invoice.status === 'void') throw new Error('Only an outstanding invoice can be closed.');
  return { paymentDate: today, amountMinor: 0, tdsMinor: 0, writeOffMinor: outstanding, method: 'other', reference: 'CLOSEOUT', notes: note.trim() || 'Closed from pending payments.' };
}

export function paymentDetails(update: Pick<TenantPayment, 'method' | 'reference' | 'notes'>) {
  if (!(paymentMethods as readonly string[]).includes(update.method)) throw new Error('Choose a valid payment method.');
  if (typeof update.reference !== 'string' || typeof update.notes !== 'string') throw new Error('Reference and notes must be text.');
  return { method: update.method, reference: update.reference.trim(), notes: update.notes.trim() };
}

function daysLate(dueDate: string, today: string) {
  const [year, month, day] = dueDate.split('-').map(Number); const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  return Math.max(0, Math.floor((Date.UTC(todayYear, todayMonth - 1, todayDay) - Date.UTC(year, month - 1, day)) / 86_400_000));
}

function agingFor(days: number): PendingPayment['agingBucket'] { if (days === 0) return 'Current'; if (days <= 30) return '1–30'; if (days <= 60) return '31–60'; if (days <= 90) return '61–90'; return '90+'; }

export function pendingPayment(invoice: TenantInvoice, reminders: PaymentReminder[], today = new Date().toISOString().slice(0, 10)): PendingPayment {
  const daysOverdue = daysLate(invoice.dueDate, today);
  return { ...invoice, outstandingMinor: invoice.totalMinor - invoice.paidMinor, daysOverdue, agingBucket: agingFor(daysOverdue), reminders };
}

/** The reminder's note, once the channel is known and the invoice still has something to pay. */
export function reminderNote(invoice: Pick<TenantInvoice, 'totalMinor' | 'paidMinor'> | null, input: { channel: PaymentReminder['channel']; note?: string }) {
  if (input.channel !== 'email' && input.channel !== 'whatsapp') throw new Error('Choose email or WhatsApp for the reminder.');
  if (!invoice) throw new Error(FOREIGN_PAYMENT_INVOICE_MESSAGE);
  if (invoice.paidMinor >= invoice.totalMinor) throw new Error('Paid invoices do not need payment reminders.');
  return input.note?.trim() ?? '';
}

export const reminderMessage = (channel: PaymentReminder['channel'], invoiceNumber: string) => `${channel === 'email' ? 'Email' : 'WhatsApp'} payment reminder recorded for ${invoiceNumber}.`;

export const FORMAT_NOT_FOUND = 'Invoice format not found.';
export const DUPLICATE_FORMAT_MESSAGE = 'A format with that name already exists.';
export const DEFAULT_FORMAT_DELETE_MESSAGE = 'The default invoice format cannot be deleted. Make another format the default first.';

/** The id every tenant's first format takes. Listing formats creates it once, so two first lists at once insert it once. */
export const standardFormatId = (tenantId: string) => `${tenantId}-format-standard`;
