import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { parseGstin } from '../invoice-gst';
import type { SmtpSettings } from '../mailer';
import { now, requireAdminRole } from './shared';
import { actorRole } from './tenants';
import { parseOperationalLogRow, parseSettingsRow, parseSmtpRow } from './rows';
import { logRetentionCutoff, operationalErrorMessage, previewTemplate, validateSettings } from './rules';
import type { TenantSettings, TenantSettingsInput, OperationalLog } from './types';

type Row = Record<string, unknown>;

export function createSettingsMethods(database: DatabaseSync) {
  const log = (tenantId: string, kind: OperationalLog['kind'], message: string, at = now()) => database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, kind, message, at);
  return {
    getTenantSettings(context: TenantContext): TenantSettings { requireAdminRole(actorRole(database, context)); return parseSettingsRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(context.tenantId) as Row); },
    updateTenantSettings(context: TenantContext, input: TenantSettingsInput): TenantSettings {
      requireAdminRole(actorRole(database, context)); const error = validateSettings(input); if (error) throw new Error(error); const { gstin, stateCode } = parseGstin(input.gstin); const current = this.getTenantSettings(context); const legalName = input.legalName === undefined ? current.legalName : input.legalName.trim(); const smtpUser = input.smtpUser === undefined ? current.smtpUser : input.smtpUser.trim(); const timestamp = now();
      database.prepare(`UPDATE tenant_settings SET company_name=?, legal_name=?, gstin=?, state_code=?, address=?, invoice_prefix=?, payment_terms_days=?, footer=?, invoice_template=?, email_subject=?, email_body=?, smtp_host=?, smtp_port=?, smtp_from=?, smtp_user=?, log_retention_days=?, logo_data_url=?, stamp_data_url=?, signature_data_url=?, updated_at=? WHERE tenant_id=?`).run(input.companyName.trim(), legalName, gstin, stateCode, input.address.trim(), input.invoicePrefix.trim().toUpperCase(), input.paymentTermsDays, input.footer.trim(), input.invoiceTemplate.trim(), input.emailSubject.trim(), input.emailBody.trim(), input.smtpHost.trim(), input.smtpPort, input.smtpFrom.trim(), smtpUser, input.logRetentionDays, input.logoDataUrl, input.stampDataUrl, input.signatureDataUrl, timestamp, context.tenantId);
      if (input.smtpPassword !== undefined) database.prepare('UPDATE tenant_settings SET smtp_password = ? WHERE tenant_id = ?').run(input.smtpPassword, context.tenantId);
      database.prepare('DELETE FROM operational_logs WHERE tenant_id = ? AND created_at < ?').run(context.tenantId, logRetentionCutoff(input.logRetentionDays));
      log(context.tenantId, 'feature-flow', 'Tenant settings were updated.', timestamp);
      return this.getTenantSettings(context);
    },
    previewTenantTemplate(context: TenantContext): string { return previewTemplate(this.getTenantSettings(context)); },
    /** The only reader of the SMTP password. It serves the mailer inside the server and no route may return it. */
    getSmtpSettings(context: TenantContext): SmtpSettings { return parseSmtpRow(database.prepare('SELECT smtp_host, smtp_port, smtp_from, smtp_user, smtp_password FROM tenant_settings WHERE tenant_id = ?').get(context.tenantId) as Row); },
    logFeatureFlow(context: TenantContext, message: string): void { log(context.tenantId, 'feature-flow', message); },
    recordOperationalError(context: TenantContext, operation: string, cause: unknown): void { log(context.tenantId, 'error', operationalErrorMessage(operation, cause)); },
    listOperationalLogs(context: TenantContext): OperationalLog[] { requireAdminRole(actorRole(database, context)); return (database.prepare('SELECT id, kind, message, created_at FROM operational_logs WHERE tenant_id = ? ORDER BY created_at DESC').all(context.tenantId) as Row[]).map(parseOperationalLogRow); },
  };
}
