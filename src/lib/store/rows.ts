import type { Membership } from '../auth/principal';
import { parseFormatDefinition, type InvoiceFormat } from '../invoice-format';
import type { SmtpSettings } from '../mailer';
import type {
  AdditionalService, BulkInvoiceRun, Contract, ContractAuditEvent, CustomerRecord, DeliveryRecord, DemoIdentity, InvoiceSnapshot, OperationalLog, PaymentReminder, Quotation, QuotationLine,
  SecurityDeposit, TaskNote, Tenant, TenantHistoryEvent, TenantName, TenantInvoice, TenantPayment, TenantRecord, TenantService, TenantSettings, TenantUser,
} from './types';
import { paymentMethods } from './rules';

// One parser per table, at the store boundary (ADR 0001, the graft from candidate C). SQLite and Postgres rows
// with the same columns parse the same way. A column with the wrong type throws here instead of leaking a bad value.

type Row = Record<string, unknown>;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`Column ${column} holds ${typeof value}, not text.`);
  return value;
}

function nullableText(row: Row, column: string): string | null {
  return row[column] === null || row[column] === undefined ? null : text(row, column);
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`Column ${column} holds ${String(value)}, not a safe integer.`);
  return value;
}

function oneOf<const T extends string>(row: Row, column: string, values: readonly T[]): T {
  const value = text(row, column);
  if (!(values as readonly string[]).includes(value)) throw new TypeError(`Column ${column} holds ${value}, not one of ${values.join(', ')}.`);
  return value as T;
}

const tenantStatuses = ['active', 'disabled'] as const;
const memberRoles = ['admin', 'user'] as const;

export function parseTenantRow(row: Row): Tenant {
  return { id: text(row, 'id'), name: text(row, 'name'), status: oneOf(row, 'status', tenantStatuses), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), userCount: integer(row, 'user_count') };
}

export function parseTenantHistoryRow(row: Row): TenantHistoryEvent {
  return { id: text(row, 'id'), tenantId: text(row, 'tenant_id'), action: oneOf(row, 'action', ['created', 'updated', 'disabled', 'enabled']), detail: text(row, 'detail'), occurredAt: text(row, 'occurred_at') };
}

export function parseTenantRecordRow(row: Row): TenantRecord {
  return { id: text(row, 'id'), tenantId: text(row, 'tenant_id'), label: text(row, 'label') };
}

/** A users row joined with its tenant's name. The SQLite superadmin row has no tenant. */
export function parseIdentityRow(row: Row): DemoIdentity {
  return { id: text(row, 'id'), name: text(row, 'name'), email: text(row, 'email'), role: oneOf(row, 'role', ['superadmin', ...memberRoles]), tenantId: nullableText(row, 'tenant_id'), tenantName: nullableText(row, 'tenant_name') };
}

export function parseMembershipRow(row: Row): Membership {
  return { tenantId: text(row, 'tenant_id'), id: text(row, 'id'), role: oneOf(row, 'role', memberRoles), status: oneOf(row, 'status', tenantStatuses) };
}

export function parseTenantNameRow(row: Row): TenantName {
  return { id: text(row, 'id'), name: text(row, 'name') };
}

export function parseTenantUserRow(row: Row): TenantUser {
  return { id: text(row, 'id'), name: text(row, 'name'), email: text(row, 'email'), role: oneOf(row, 'role', memberRoles), status: oneOf(row, 'status', tenantStatuses), createdAt: text(row, 'created_at') };
}

/** A tenant_settings row. The SMTP password never leaves it; only whether one is set. */
export function parseSettingsRow(row: Row): TenantSettings {
  return {
    companyName: text(row, 'company_name'), legalName: text(row, 'legal_name'), gstin: text(row, 'gstin'), stateCode: text(row, 'state_code'), address: text(row, 'address'),
    invoicePrefix: text(row, 'invoice_prefix'), paymentTermsDays: integer(row, 'payment_terms_days'), footer: text(row, 'footer'), invoiceTemplate: text(row, 'invoice_template'),
    emailSubject: text(row, 'email_subject'), emailBody: text(row, 'email_body'), smtpHost: text(row, 'smtp_host'), smtpPort: integer(row, 'smtp_port'), smtpFrom: text(row, 'smtp_from'),
    smtpUser: text(row, 'smtp_user'), smtpPasswordSet: text(row, 'smtp_password') !== '', logRetentionDays: integer(row, 'log_retention_days'), logoDataUrl: text(row, 'logo_data_url'),
    stampDataUrl: text(row, 'stamp_data_url'), signatureDataUrl: text(row, 'signature_data_url'), updatedAt: text(row, 'updated_at'),
  };
}

export function parseSmtpRow(row: Row): SmtpSettings {
  return { host: text(row, 'smtp_host'), port: integer(row, 'smtp_port'), from: text(row, 'smtp_from'), user: text(row, 'smtp_user'), password: text(row, 'smtp_password') };
}

export function parseOperationalLogRow(row: Row): OperationalLog {
  return { id: text(row, 'id'), kind: oneOf(row, 'kind', ['feature-flow', 'error']), message: text(row, 'message'), createdAt: text(row, 'created_at') };
}

const billingFrequencies = ['monthly', 'quarterly', 'halfYearly', 'annual'] as const;

export function parseServiceRow(row: Row): TenantService {
  return {
    id: text(row, 'id'), name: text(row, 'name'), description: text(row, 'description'), hsnSac: text(row, 'hsn_sac'), status: oneOf(row, 'status', ['active', 'inactive']),
    prices: { monthly: integer(row, 'monthly_minor'), quarterly: integer(row, 'quarterly_minor'), halfYearly: integer(row, 'half_yearly_minor'), annual: integer(row, 'annual_minor') },
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

export function parseCustomerRow(row: Row): CustomerRecord {
  return {
    id: text(row, 'id'), tenantId: text(row, 'tenant_id'), companyName: text(row, 'company_name'), contactName: text(row, 'contact_name'), email: text(row, 'email'), phone: text(row, 'phone'),
    gstin: text(row, 'gstin'), stateCode: text(row, 'state_code'), billingAddress: text(row, 'billing_address'), invoiceDelivery: oneOf(row, 'invoice_delivery', ['monthly', 'quarterly', 'email', 'manual']),
    status: oneOf(row, 'status', ['active', 'inactive']), invoiceFormatId: nullableText(row, 'invoice_format_id'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

export function parseQuotationLineRow(row: Row): QuotationLine {
  return {
    id: text(row, 'id'), serviceId: text(row, 'service_id'), serviceName: text(row, 'service_name'), frequency: oneOf(row, 'frequency', billingFrequencies),
    quantity: integer(row, 'quantity'), unitPriceMinor: integer(row, 'unit_price_minor'), lineTotalMinor: integer(row, 'line_total_minor'),
  };
}

function finite(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Column ${column} holds ${String(value)}, not a number.`);
  return value;
}

/** A JSON array of whole numbers: text from SQLite, already parsed from a Postgres jsonb column. */
function integers(row: Row, column: string): number[] {
  const raw = row[column];
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item))) throw new TypeError(`Column ${column} holds ${String(raw)}, not a list of whole numbers.`);
  return value as number[];
}

export type ContractServiceRef = { id: string; name: string };

/** A contracts row joined with its customer's name, and the services it covers in name order. */
export function parseContractRow(row: Row, services: readonly ContractServiceRef[]): Contract {
  return {
    id: text(row, 'id'), tenantId: text(row, 'tenant_id'), customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'), name: text(row, 'name'),
    serviceIds: services.map((service) => service.id), services: services.map((service) => service.name), startDate: text(row, 'start_date'), endDate: text(row, 'end_date'),
    valueMinor: integer(row, 'value_minor'), paymentTermsDays: integer(row, 'payment_terms_days'), billingFrequency: oneOf(row, 'billing_frequency', billingFrequencies),
    invoiceMonths: integers(row, 'invoice_months'), cycleDay: integer(row, 'cycle_day'), escalationPercent: finite(row, 'escalation_percent'),
    escalationReviewDate: nullableText(row, 'escalation_review_date'), renewalNoticeDays: integer(row, 'renewal_notice_days'), securityDepositMinor: integer(row, 'security_deposit_minor'),
    status: oneOf(row, 'status', ['active', 'inactive']), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

export function parseContractServiceRow(row: Row): ContractServiceRef {
  return { id: text(row, 'id'), name: text(row, 'name') };
}

export function parseContractAuditRow(row: Row): ContractAuditEvent {
  return { id: text(row, 'id'), action: text(row, 'action'), detail: text(row, 'detail'), occurredAt: text(row, 'occurred_at') };
}

/** A security_deposits row joined with its customer's name. */
export function parseDepositRow(row: Row): SecurityDeposit {
  const amountMinor = integer(row, 'amount_minor');
  const settledMinor = integer(row, 'settled_minor');
  return {
    id: text(row, 'id'), contractId: text(row, 'contract_id'), customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'), amountMinor, settledMinor,
    balanceMinor: amountMinor - settledMinor, status: oneOf(row, 'status', ['held', 'settled']), createdAt: text(row, 'created_at'), settledAt: nullableText(row, 'settled_at'),
    settlementNote: nullableText(row, 'settlement_note') || null,
  };
}

/** A task_notes row joined with its customer's name. */
export function parseTaskNoteRow(row: Row): TaskNote {
  return { id: text(row, 'id'), tenantId: text(row, 'tenant_id'), customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'), date: text(row, 'note_date'), note: text(row, 'note'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}

/** An additional_services row joined with its customer's and contract's names. */
export function parseAdditionalServiceRow(row: Row): AdditionalService {
  return {
    id: text(row, 'id'), tenantId: text(row, 'tenant_id'), customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'), contractId: text(row, 'contract_id'),
    contractName: text(row, 'contract_name'), serviceDate: text(row, 'service_date'), description: text(row, 'description'), priceMinor: integer(row, 'price_minor'), notes: text(row, 'notes'),
    status: oneOf(row, 'status', ['active', 'archived']), billedAt: nullableText(row, 'billed_at') || null, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  };
}

/** A JSON object: text from SQLite, already parsed from a Postgres jsonb column. */
function object(row: Row, column: string): Record<string, unknown> {
  const raw = row[column];
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Column ${column} holds ${String(raw)}, not a JSON object.`);
  return value as Record<string, unknown>;
}

/** An invoices row joined with its customer's name. The snapshot is what the invoice printed when it was issued. */
export function parseInvoiceRow(row: Row): TenantInvoice {
  return {
    id: text(row, 'id'), tenantId: text(row, 'tenant_id'), contractId: nullableText(row, 'contract_id') || null, customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'),
    invoiceNumber: text(row, 'invoice_number'), invoiceDate: text(row, 'invoice_date'), dueDate: text(row, 'due_date'), taxableMinor: integer(row, 'taxable_minor'), gstRate: finite(row, 'gst_rate'),
    gstMinor: integer(row, 'gst_minor'), totalMinor: integer(row, 'total_minor'), paidMinor: integer(row, 'paid_minor'), status: oneOf(row, 'status', ['issued', 'paid', 'partial', 'overdue', 'void']),
    snapshot: object(row, 'snapshot') as InvoiceSnapshot, issuedAt: text(row, 'issued_at'),
  };
}

export function parseBulkRunRow(row: Row): BulkInvoiceRun {
  return { id: text(row, 'id'), billingPeriod: text(row, 'billing_period'), generatedCount: integer(row, 'generated_count'), skippedCount: integer(row, 'skipped_count'), createdAt: text(row, 'created_at') };
}

const addresses = (row: Row, column: string) => text(row, column).split(',').filter(Boolean);

/** A delivery_log row joined with the name of the user who made the attempt, which is blank once that user is gone. */
export function parseDeliveryRow(row: Row): DeliveryRecord {
  return {
    id: text(row, 'id'), invoiceId: text(row, 'invoice_id'), channel: oneOf(row, 'channel', ['email']), to: addresses(row, 'to_address'), cc: addresses(row, 'cc_address'), subject: text(row, 'subject'),
    status: oneOf(row, 'status', ['sent', 'failed', 'not-configured']), error: text(row, 'error'), attemptedAt: text(row, 'attempted_at'), attemptedBy: text(row, 'attempted_by'),
    attemptedByName: nullableText(row, 'attempted_by_name') ?? '',
  };
}

/** A payments row joined with its invoice's number and customer. What it applies to the invoice is the payment, TDS and write-off together. */
export function parsePaymentRow(row: Row): TenantPayment {
  const amountMinor = integer(row, 'amount_minor'); const tdsMinor = integer(row, 'tds_minor'); const writeOffMinor = integer(row, 'write_off_minor');
  return {
    id: text(row, 'id'), invoiceId: text(row, 'invoice_id'), invoiceNumber: text(row, 'invoice_number'), customerId: text(row, 'customer_id'), customerName: text(row, 'customer_name'), paymentDate: text(row, 'payment_date'),
    amountMinor, tdsMinor, writeOffMinor, appliedMinor: amountMinor + tdsMinor + writeOffMinor, method: oneOf(row, 'method', paymentMethods), reference: text(row, 'reference'), notes: text(row, 'notes'),
    recordedAt: text(row, 'recorded_at'),
  };
}

export function parseReminderRow(row: Row): PaymentReminder {
  return { id: text(row, 'id'), invoiceId: text(row, 'invoice_id'), channel: oneOf(row, 'channel', ['email', 'whatsapp']), note: text(row, 'note'), createdAt: text(row, 'created_at') };
}

export function parseInvoiceFormatRow(row: Row): InvoiceFormat {
  return { id: text(row, 'id'), name: text(row, 'name'), isDefault: integer(row, 'is_default') === 1, definition: parseFormatDefinition(object(row, 'definition')) };
}

/** A quotations row with its lines. A set archived_at is what makes it archived; the status column only ever holds draft. */
export function parseQuotationRow(row: Row, lines: QuotationLine[]): Quotation {
  return {
    id: text(row, 'id'), quoteNumber: text(row, 'quote_number'), customerName: text(row, 'customer_name'), customerEmail: nullableText(row, 'customer_email'),
    status: nullableText(row, 'archived_at') === null ? 'draft' : 'archived', lines, totalMinor: integer(row, 'total_minor'), createdAt: text(row, 'created_at'),
  };
}
