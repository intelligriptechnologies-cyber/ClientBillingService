import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseGstin } from '../../invoice-gst';
import type { SmtpSettings } from '../../mailer';
import { parseOperationalLogRow, parseSettingsRow, parseSmtpRow } from '../rows';
import { logRetentionCutoff, operationalErrorMessage, previewTemplate, validateSettings } from '../rules';
import { now, requireAdminRole } from '../shared';
import type { OperationalLog, TenantSettings, TenantSettingsInput, TenantStore } from '../types';
import { actorRole } from './shared';

type Row = Record<string, unknown>;

async function readSettings(tx: Tx, context: TenantContext): Promise<TenantSettings> {
  requireAdminRole(await actorRole(tx, context));
  const { rows } = await tx.query<Row>('SELECT * FROM tenant_settings WHERE tenant_id = $1', [context.tenantId]);
  return parseSettingsRow(rows[0]);
}

async function log(tx: Tx, tenantId: string, kind: OperationalLog['kind'], message: string, at = now()) {
  await tx.query('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES ($1, $2, $3, $4, $5)', [crypto.randomUUID(), tenantId, kind, message, at]);
}

export function createPgSettingsMethods(db: Database) {
  return {
    async getTenantSettings(context: TenantContext): Promise<TenantSettings> {
      return db.withTenant(context.tenantId, (tx) => readSettings(tx, context));
    },
    /** One UPDATE, with COALESCE keeping the legal name, SMTP user and password a save leaves out, so a concurrent save cannot write back a stale copy of them. */
    async updateTenantSettings(context: TenantContext, input: TenantSettingsInput): Promise<TenantSettings> {
      return db.withTenant(context.tenantId, async (tx) => {
        requireAdminRole(await actorRole(tx, context));
        const error = validateSettings(input);
        if (error) throw new Error(error);
        const { gstin, stateCode } = parseGstin(input.gstin);
        const timestamp = now();
        const { rows } = await tx.query<Row>(
          `UPDATE tenant_settings SET company_name = $1, legal_name = COALESCE($2, legal_name), gstin = $3, state_code = $4, address = $5, invoice_prefix = $6,
             payment_terms_days = $7, footer = $8, invoice_template = $9, email_subject = $10, email_body = $11, smtp_host = $12, smtp_port = $13, smtp_from = $14,
             smtp_user = COALESCE($15, smtp_user), smtp_password = COALESCE($16, smtp_password), log_retention_days = $17, logo_data_url = $18, stamp_data_url = $19,
             signature_data_url = $20, updated_at = $21
           WHERE tenant_id = $22 RETURNING *`,
          [input.companyName.trim(), input.legalName?.trim() ?? null, gstin, stateCode, input.address.trim(), input.invoicePrefix.trim().toUpperCase(),
            input.paymentTermsDays, input.footer.trim(), input.invoiceTemplate.trim(), input.emailSubject.trim(), input.emailBody.trim(), input.smtpHost.trim(), input.smtpPort, input.smtpFrom.trim(),
            input.smtpUser?.trim() ?? null, input.smtpPassword ?? null, input.logRetentionDays, input.logoDataUrl, input.stampDataUrl,
            input.signatureDataUrl, timestamp, context.tenantId],
        );
        await tx.query('DELETE FROM operational_logs WHERE tenant_id = $1 AND created_at < $2', [context.tenantId, logRetentionCutoff(input.logRetentionDays)]);
        await log(tx, context.tenantId, 'feature-flow', 'Tenant settings were updated.', timestamp);
        return parseSettingsRow(rows[0]);
      });
    },
    async previewTenantTemplate(context: TenantContext): Promise<string> {
      return previewTemplate(await db.withTenant(context.tenantId, (tx) => readSettings(tx, context)));
    },
    /** The only reader of the SMTP password. It serves the mailer inside the server and no route may return it. */
    async getSmtpSettings(context: TenantContext): Promise<SmtpSettings> {
      return db.withTenant(context.tenantId, async (tx) => parseSmtpRow((await tx.query<Row>('SELECT smtp_host, smtp_port, smtp_from, smtp_user, smtp_password FROM tenant_settings WHERE tenant_id = $1', [context.tenantId])).rows[0]));
    },
    async logFeatureFlow(context: TenantContext, message: string): Promise<void> {
      await db.withTenant(context.tenantId, (tx) => log(tx, context.tenantId, 'feature-flow', message));
    },
    async recordOperationalError(context: TenantContext, operation: string, cause: unknown): Promise<void> {
      await db.withTenant(context.tenantId, (tx) => log(tx, context.tenantId, 'error', operationalErrorMessage(operation, cause)));
    },
    async listOperationalLogs(context: TenantContext): Promise<OperationalLog[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        requireAdminRole(await actorRole(tx, context));
        return (await tx.query<Row>('SELECT id, kind, message, created_at FROM operational_logs WHERE tenant_id = $1 ORDER BY created_at DESC, id', [context.tenantId])).rows.map(parseOperationalLogRow);
      });
    },
  } satisfies Partial<TenantStore>;
}
