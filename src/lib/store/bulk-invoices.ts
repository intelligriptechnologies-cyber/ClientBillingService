import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { contractWithServices } from './contracts';
import { parseBulkRunRow, parseCustomerRow, parseSettingsRow } from './rows';
import { resolveFormatForInvoice } from './invoice-formats';
import { billingPeriodDays, bulkInvoicePreview, bulkInvoiceSnapshot, bulkRunMessage, invoiceNumber, type BulkAddition } from './rules';
import type { BulkInvoicePreview, BulkInvoiceRun, BulkInvoiceGeneration } from './types';

type Row = Record<string, unknown>;

const runColumns = 'id, billing_period, generated_count, skipped_count, created_at';

export function createBulkInvoiceMethods(database: DatabaseSync) {
  const settingsOf = (tenantId: string) => parseSettingsRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(tenantId) as Row);
  function preview(tenantId: string, billingPeriod: string): BulkInvoicePreview {
    billingPeriodDays(billingPeriod);
    const contracts = (database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.tenant_id = ? ORDER BY contracts.name').all(tenantId) as Row[]).map((row) => contractWithServices(database, row));
    const additions = (database.prepare(`SELECT id, contract_id, description, price_minor, service_date FROM additional_services WHERE tenant_id = ? AND status = 'active' AND billed_at IS NULL AND service_date LIKE ?`).all(tenantId, `${billingPeriod}%`) as Row[])
      .map((row): BulkAddition => ({ id: String(row.id), contractId: String(row.contract_id), description: String(row.description), priceMinor: Number(row.price_minor), serviceDate: String(row.service_date) }));
    const invoiced = new Set((database.prepare('SELECT DISTINCT contract_id FROM invoices WHERE tenant_id = ? AND contract_id IS NOT NULL AND substr(invoice_date, 1, 7) = ?').all(tenantId, billingPeriod) as Row[]).map((row) => String(row.contract_id)));
    const services = new Map((database.prepare('SELECT id, name, hsn_sac FROM services WHERE tenant_id = ?').all(tenantId) as Row[]).map((row) => [String(row.id), { name: String(row.name), hsnSac: String(row.hsn_sac) }]));
    return bulkInvoicePreview(billingPeriod, contracts, additions, invoiced, services, settingsOf(tenantId).stateCode);
  }

  return {
    previewBulkInvoices(context: TenantContext, billingPeriod: string): BulkInvoicePreview { return preview(context.tenantId, billingPeriod); },
    listBulkInvoiceRuns(context: TenantContext): BulkInvoiceRun[] {
      return (database.prepare(`SELECT ${runColumns} FROM bulk_invoice_runs WHERE tenant_id = ? ORDER BY billing_period DESC`).all(context.tenantId) as Row[]).map(parseBulkRunRow);
    },
    generateBulkInvoices(context: TenantContext, billingPeriod: string): BulkInvoiceGeneration {
      const tenantId = context.tenantId;
      billingPeriodDays(billingPeriod);
      database.exec('BEGIN IMMEDIATE');
      try {
        const existing = database.prepare(`SELECT ${runColumns} FROM bulk_invoice_runs WHERE tenant_id = ? AND billing_period = ?`).get(tenantId, billingPeriod) as Row | undefined;
        if (existing) { database.exec('COMMIT'); const run = parseBulkRunRow(existing); return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: true, run }; }
        const proposals = preview(tenantId, billingPeriod);
        const settings = settingsOf(tenantId);
        const sequenceStart = Number((database.prepare('SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ?').get(tenantId) as { count: number }).count);
        const timestamp = now();
        const insertInvoice = database.prepare('INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)');
        const markAdditionalBilled = database.prepare('UPDATE additional_services SET billed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND billed_at IS NULL');
        for (const [index, proposal] of proposals.proposed.entries()) {
          const customer = parseCustomerRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(proposal.customerId, tenantId) as Row);
          const snapshot = bulkInvoiceSnapshot(proposal, settings, customer, resolveFormatForInvoice(database, tenantId, undefined, customer.invoiceFormatId));
          insertInvoice.run(`${tenantId}-invoice-${crypto.randomUUID()}`, tenantId, proposal.contractId, proposal.customerId, invoiceNumber(settings.invoicePrefix, sequenceStart + index + 1), proposal.invoiceDate, proposal.dueDate, proposal.taxableMinor, proposal.gstRate, proposal.gstMinor, proposal.totalMinor, 'issued', JSON.stringify(snapshot), timestamp);
          for (const line of proposal.additionalLines) markAdditionalBilled.run(timestamp, timestamp, line.id, tenantId);
        }
        const run: BulkInvoiceRun = { id: `${tenantId}-bulk-run-${crypto.randomUUID()}`, billingPeriod, generatedCount: proposals.proposed.length, skippedCount: proposals.skipped.length, createdAt: timestamp };
        database.prepare('INSERT INTO bulk_invoice_runs (id, tenant_id, billing_period, generated_count, skipped_count, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(run.id, tenantId, billingPeriod, run.generatedCount, run.skippedCount, JSON.stringify(proposals), timestamp);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, 'feature-flow', bulkRunMessage(billingPeriod, run.generatedCount, run.skippedCount), timestamp);
        database.exec('COMMIT');
        return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: false, run };
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
}
