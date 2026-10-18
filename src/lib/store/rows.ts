import type { SmtpSettings } from '../mailer';
import type { DemoIdentity, OperationalLog, Tenant, TenantHistoryEvent, TenantRecord, TenantSettings, TenantUser } from './types';

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
