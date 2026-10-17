import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import { gstSnapshotFields, resolveSupply } from '../invoice-gst';
import { contractFromRow } from './contracts';
import { settingsFromRow } from './settings';
import type { AppSession, Contract, InvoiceSnapshot, BulkInvoiceAdditionalLine, BulkInvoiceProposal, BulkInvoiceSkip, BulkInvoicePreview, BulkInvoiceRun, BulkInvoiceGeneration } from './types';

function bulkRunFromRow(row: Record<string, unknown>): BulkInvoiceRun { return { id: String(row.id), billingPeriod: String(row.billing_period), generatedCount: Number(row.generated_count), skippedCount: Number(row.skipped_count), createdAt: String(row.created_at) }; }
function billingPeriodStart(period: string) { if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Billing period must use YYYY-MM.'); return `${period}-01`; }
function billingPeriodEnd(period: string) { const [year, month] = period.split('-').map(Number); return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }
function addCalendarDays(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function isScheduledForPeriod(contract: Contract, month: number) { return contract.billingFrequency === 'monthly' || contract.invoiceMonths.includes(month); }

export function createBulkInvoiceMethods(database: DatabaseSync) {
  function buildBulkPreview(session: AppSession, billingPeriod: string): BulkInvoicePreview {
    requireTenantMember(session);
    const periodStart = billingPeriodStart(billingPeriod); const periodEnd = billingPeriodEnd(billingPeriod); const month = Number(billingPeriod.slice(5));
    const rows = database.prepare(`SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.tenant_id = ? ORDER BY contracts.name`).all(session.tenantId) as Record<string, unknown>[];
    const additionalRows = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id WHERE additional_services.tenant_id = ? AND additional_services.status = 'active' AND additional_services.billed_at IS NULL AND additional_services.service_date LIKE ?`).all(session.tenantId, `${billingPeriod}%`) as Record<string, unknown>[];
    const additionsByContract = new Map<string, BulkInvoiceAdditionalLine[]>();
    for (const row of additionalRows) {
      const line = { id: String(row.id), description: String(row.description), priceMinor: Number(row.price_minor), serviceDate: String(row.service_date) };
      additionsByContract.set(String(row.contract_id), [...(additionsByContract.get(String(row.contract_id)) ?? []), line]);
    }
    const proposed: BulkInvoiceProposal[] = []; const skipped: BulkInvoiceSkip[] = [];
    for (const row of rows) {
      const contract = contractFromRow(database, row);
      const common = { contractId: contract.id, contractName: contract.name, customerName: contract.customerName };
      if (contract.status !== 'active') { skipped.push({ ...common, reason: 'Contract is inactive.' }); continue; }
      if (contract.startDate > periodEnd || contract.endDate < periodStart) { skipped.push({ ...common, reason: 'Contract is outside this billing period.' }); continue; }
      if (!isScheduledForPeriod(contract, month)) { skipped.push({ ...common, reason: `Billing is not scheduled for ${new Date(`${billingPeriod}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })}.` }); continue; }
      const prior = database.prepare('SELECT 1 FROM invoices WHERE tenant_id = ? AND contract_id = ? AND substr(invoice_date, 1, 7) = ?').get(session.tenantId, contract.id, billingPeriod);
      if (prior) { skipped.push({ ...common, reason: 'An invoice already exists for this contract and period.' }); continue; }
      const additionalLines = additionsByContract.get(contract.id) ?? [];
      const taxableMinor = contract.valueMinor + additionalLines.reduce((total, line) => total + line.priceMinor, 0);
      const gstRate = 18; const gstMinor = Math.round(taxableMinor * gstRate / 100);
      proposed.push({ ...common, customerId: contract.customerId, billingPeriod, invoiceDate: periodStart, dueDate: addCalendarDays(periodStart, contract.paymentTermsDays), taxableMinor, gstRate, gstMinor, totalMinor: taxableMinor + gstMinor, additionalLines });
    }
    return { billingPeriod, proposed, skipped };
  }

  return {
    previewBulkInvoices(session: AppSession, billingPeriod: string): BulkInvoicePreview { return buildBulkPreview(session, billingPeriod); },
    listBulkInvoiceRuns(session: AppSession): BulkInvoiceRun[] {
      requireTenantMember(session);
      return (database.prepare('SELECT id, billing_period, generated_count, skipped_count, created_at FROM bulk_invoice_runs WHERE tenant_id = ? ORDER BY billing_period DESC').all(session.tenantId) as Record<string, unknown>[]).map(bulkRunFromRow);
    },
    generateBulkInvoices(session: AppSession, billingPeriod: string): BulkInvoiceGeneration {
      requireTenantMember(session); billingPeriodStart(billingPeriod);
      database.exec('BEGIN IMMEDIATE');
      try {
        const existing = database.prepare('SELECT id, billing_period, generated_count, skipped_count, created_at FROM bulk_invoice_runs WHERE tenant_id = ? AND billing_period = ?').get(session.tenantId, billingPeriod) as Record<string, unknown> | undefined;
        if (existing) { database.exec('COMMIT'); const run = bulkRunFromRow(existing); return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: true, run }; }
        const preview = buildBulkPreview(session, billingPeriod);
        const settings = settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>);
        const sequenceStart = Number((database.prepare('SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ?').get(session.tenantId) as { count: number }).count);
        const timestamp = now();
        const insertInvoice = database.prepare('INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)');
        const markAdditionalBilled = database.prepare('UPDATE additional_services SET billed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND billed_at IS NULL');
        for (const [index, proposal] of preview.proposed.entries()) {
          const customer = database.prepare('SELECT company_name, email, billing_address, gstin, state_code FROM customers WHERE id = ? AND tenant_id = ?').get(proposal.customerId, session.tenantId) as Record<string, unknown>;
          const supply = resolveSupply(settings.stateCode, { gstin: String(customer.gstin), stateCode: String(customer.state_code) });
          const gstFields = gstSnapshotFields({ seller: settings, supply, lines: [{ taxType: proposal.gstRate > 0 ? supply.expectedTaxType ?? 'igst' : 'none', gstRate: proposal.gstRate }], requireHsn: false });
          const snapshot: InvoiceSnapshot = { companyName: settings.companyName, gstin: settings.gstin, address: settings.address, logoDataUrl: settings.logoDataUrl, stampDataUrl: settings.stampDataUrl, signatureDataUrl: settings.signatureDataUrl, customerName: String(customer.company_name), customerEmail: String(customer.email), customerAddress: String(customer.billing_address), customerGstin: String(customer.gstin), gstRate: proposal.gstRate, footer: settings.footer, invoiceTemplate: settings.invoiceTemplate, ...gstFields };
          const number = `${settings.invoicePrefix}-${String(sequenceStart + index + 1).padStart(4, '0')}`;
          insertInvoice.run(`${session.tenantId}-invoice-${crypto.randomUUID()}`, session.tenantId, proposal.contractId, proposal.customerId, number, proposal.invoiceDate, proposal.dueDate, proposal.taxableMinor, proposal.gstRate, proposal.gstMinor, proposal.totalMinor, 'issued', JSON.stringify(snapshot), timestamp);
          for (const line of proposal.additionalLines) markAdditionalBilled.run(timestamp, timestamp, line.id, session.tenantId);
        }
        const run: BulkInvoiceRun = { id: `${session.tenantId}-bulk-run-${crypto.randomUUID()}`, billingPeriod, generatedCount: preview.proposed.length, skippedCount: preview.skipped.length, createdAt: timestamp };
        database.prepare('INSERT INTO bulk_invoice_runs (id, tenant_id, billing_period, generated_count, skipped_count, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(run.id, session.tenantId, billingPeriod, run.generatedCount, run.skippedCount, JSON.stringify(preview), timestamp);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Bulk invoice run for ${billingPeriod} issued ${run.generatedCount} invoice(s); ${run.skippedCount} contract(s) skipped.`, timestamp);
        database.exec('COMMIT');
        return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: false, run };
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
}
