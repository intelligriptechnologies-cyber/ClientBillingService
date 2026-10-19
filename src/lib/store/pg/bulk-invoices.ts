import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseBulkRunRow } from '../rows';
import { billingPeriodDays, bulkInvoicePreview, bulkInvoiceSnapshot, bulkRunMessage, type BulkAddition } from '../rules';
import { now } from '../shared';
import type { BulkInvoiceGeneration, BulkInvoicePreview, BulkInvoiceRun, TenantStore } from '../types';
import { withServices } from './contracts';
import { findCustomer } from './customers';
import { resolveFormat } from './invoice-formats';
import { insertInvoice, logFlow, tenantSettings } from './invoices';

type Row = Record<string, unknown>;

const runColumns = 'id, billing_period, generated_count, skipped_count, created_at';

/**
 * The run for `billingPeriod` as it would go now. The period is a half-open range of days on the date columns, where
 * SQLite matches text prefixes. `lockAdditions` locks the unbilled additional services it bills, so none changes price
 * between the preview and being marked billed.
 */
async function preview(tx: Tx, tenantId: string, billingPeriod: string, lockAdditions = false): Promise<BulkInvoicePreview> {
  const days = billingPeriodDays(billingPeriod);
  const { rows } = await tx.query<Row>(
    `SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.tenant_id = contracts.tenant_id AND customers.id = contracts.customer_id
     WHERE contracts.tenant_id = $1 ORDER BY contracts.name COLLATE "C", contracts.id COLLATE "C"`,
    [tenantId],
  );
  const additions = (await tx.query<Row>(
    `SELECT id, contract_id, description, price_minor, service_date FROM additional_services
     WHERE tenant_id = $1 AND status = 'active' AND billed_at IS NULL AND service_date >= $2 AND service_date < $3 ORDER BY created_at, id COLLATE "C"${lockAdditions ? ' FOR UPDATE' : ''}`,
    [tenantId, days.start, days.end],
  )).rows.map((row): BulkAddition => ({ id: String(row.id), contractId: String(row.contract_id), description: String(row.description), priceMinor: Number(row.price_minor), serviceDate: String(row.service_date) }));
  const invoiced = await tx.query<Row>('SELECT DISTINCT contract_id FROM invoices WHERE tenant_id = $1 AND contract_id IS NOT NULL AND invoice_date >= $2 AND invoice_date < $3', [tenantId, days.start, days.end]);
  const services = new Map((await tx.query<Row>('SELECT id, name, hsn_sac FROM services WHERE tenant_id = $1', [tenantId])).rows.map((row) => [String(row.id), { name: String(row.name), hsnSac: String(row.hsn_sac) }]));
  return bulkInvoicePreview(billingPeriod, await withServices(tx, tenantId, rows), additions, new Set(invoiced.rows.map((row) => String(row.contract_id))), services, (await tenantSettings(tx, tenantId)).stateCode);
}

export function createPgBulkInvoiceMethods(db: Database) {
  return {
    async previewBulkInvoices(context: TenantContext, billingPeriod: string): Promise<BulkInvoicePreview> {
      billingPeriodDays(billingPeriod);
      return db.withTenant(context.tenantId, (tx) => preview(tx, context.tenantId, billingPeriod));
    },
    async listBulkInvoiceRuns(context: TenantContext): Promise<BulkInvoiceRun[]> {
      return db.withTenant(context.tenantId, async (tx) => (await tx.query<Row>(`SELECT ${runColumns} FROM bulk_invoice_runs WHERE tenant_id = $1 ORDER BY billing_period DESC`, [context.tenantId])).rows.map(parseBulkRunRow));
    },
    /**
     * Claims the period first by inserting its run row. A second run for the period waits on that row's unique key
     * until the first commits, then finds the run and issues nothing. If the first rolls back, the second goes ahead.
     */
    async generateBulkInvoices(context: TenantContext, billingPeriod: string): Promise<BulkInvoiceGeneration> {
      const tenantId = context.tenantId;
      billingPeriodDays(billingPeriod);
      return db.withTenant(tenantId, async (tx) => {
        const timestamp = now();
        const runId = `${tenantId}-bulk-run-${crypto.randomUUID()}`;
        const claimed = await tx.query(`INSERT INTO bulk_invoice_runs (id, tenant_id, billing_period, generated_count, skipped_count, details, created_at) VALUES ($1, $2, $3, 0, 0, '{}', $4) ON CONFLICT (tenant_id, billing_period) DO NOTHING RETURNING id`, [runId, tenantId, billingPeriod, timestamp]);
        if (!claimed.rows[0]) {
          const run = parseBulkRunRow((await tx.query<Row>(`SELECT ${runColumns} FROM bulk_invoice_runs WHERE tenant_id = $1 AND billing_period = $2`, [tenantId, billingPeriod])).rows[0]);
          return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: true, run };
        }
        const proposals = await preview(tx, tenantId, billingPeriod, true);
        const settings = await tenantSettings(tx, tenantId);
        for (const proposal of proposals.proposed) {
          const customer = (await findCustomer(tx, tenantId, proposal.customerId))!;
          const snapshot = bulkInvoiceSnapshot(proposal, settings, customer, await resolveFormat(tx, tenantId, undefined, customer.invoiceFormatId));
          await insertInvoice(tx, tenantId, settings.invoicePrefix, { ...proposal, snapshot }, timestamp);
          for (const line of proposal.additionalLines) await tx.query('UPDATE additional_services SET billed_at = $1, updated_at = $1 WHERE id = $2 AND tenant_id = $3 AND billed_at IS NULL', [timestamp, line.id, tenantId]);
        }
        const run: BulkInvoiceRun = { id: runId, billingPeriod, generatedCount: proposals.proposed.length, skippedCount: proposals.skipped.length, createdAt: timestamp };
        await tx.query('UPDATE bulk_invoice_runs SET generated_count = $1, skipped_count = $2, details = $3 WHERE id = $4 AND tenant_id = $5', [run.generatedCount, run.skippedCount, JSON.stringify(proposals), runId, tenantId]);
        await logFlow(tx, tenantId, bulkRunMessage(billingPeriod, run.generatedCount, run.skippedCount), timestamp);
        return { billingPeriod, generatedCount: run.generatedCount, skippedCount: run.skippedCount, alreadyGenerated: false, run };
      });
    },
  } satisfies Partial<TenantStore>;
}
