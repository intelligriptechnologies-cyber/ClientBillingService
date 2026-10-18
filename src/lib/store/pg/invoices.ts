import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { resolveSupply } from '../../invoice-gst';
import { parseInvoiceRow, parseSettingsRow } from '../rows';
import {
  clientForSupply, correctionReason, gstSalesReport, INVOICE_CONTRACT_MESSAGE, INVOICE_CUSTOMER_MESSAGE, invoiceAmounts, invoiceNumber, invoiceTax, issuedInvoiceSnapshot, monthDays, replacementInput,
  reportMonthDays, voidReason,
} from '../rules';
import { now } from '../shared';
import type { GstSalesReport, InvoiceInput, InvoiceList, InvoiceQuery, InvoiceSnapshot, TenantInvoice, TenantSettings, TenantStore } from '../types';
import { findCustomer } from './customers';
import { existingFormatId, resolveFormat } from './invoice-formats';

type Row = Record<string, unknown>;

const invoiceWithCustomer = 'SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.tenant_id = invoices.tenant_id AND customers.id = invoices.customer_id';

/** The tenant's invoice, or null. `forUpdate` locks the invoices row, not the customer it joins. */
export async function findInvoice(tx: Tx, tenantId: string, invoiceId: string, forUpdate = false): Promise<TenantInvoice | null> {
  const { rows } = await tx.query<Row>(`${invoiceWithCustomer} WHERE invoices.id = $1 AND invoices.tenant_id = $2${forUpdate ? ' FOR UPDATE OF invoices' : ''}`, [invoiceId, tenantId]);
  return rows[0] ? parseInvoiceRow(rows[0]) : null;
}

export async function tenantSettings(tx: Tx, tenantId: string): Promise<TenantSettings> {
  return parseSettingsRow((await tx.query<Row>('SELECT * FROM tenant_settings WHERE tenant_id = $1', [tenantId])).rows[0]);
}

export async function logFlow(tx: Tx, tenantId: string, message: string, at = now()) {
  await tx.query(`INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES ($1, $2, 'feature-flow', $3, $4)`, [crypto.randomUUID(), tenantId, message, at]);
}

/**
 * The tenant's next invoice number. UPDATE ... RETURNING keeps the counter row locked until the transaction ends, so
 * issues take turns and one that rolls back gives its number back. A tenant without a row starts one from the invoices
 * it has; when two first issues race, the second waits on the first's row and then updates it.
 */
async function nextSequence(tx: Tx, tenantId: string): Promise<number> {
  const take = async () => (await tx.query<Row>('UPDATE invoice_counters SET last_number = last_number + 1 WHERE tenant_id = $1 RETURNING last_number', [tenantId])).rows[0];
  let taken = await take();
  if (!taken) {
    await tx.query('INSERT INTO invoice_counters (tenant_id, last_number) SELECT $1::text, count(*) FROM invoices WHERE tenant_id = $1 ON CONFLICT (tenant_id) DO NOTHING', [tenantId]);
    taken = await take();
  }
  return Number(taken.last_number);
}

type InvoiceRowInput = { contractId: string | null; customerId: string; invoiceDate: string; dueDate: string; taxableMinor: number; gstRate: number; gstMinor: number; totalMinor: number; snapshot: InvoiceSnapshot };

/** Inserts an issued invoice under the tenant's next number and returns its id. */
export async function insertInvoice(tx: Tx, tenantId: string, prefix: string, invoice: InvoiceRowInput, issuedAt = now()): Promise<string> {
  const id = `${tenantId}-invoice-${crypto.randomUUID()}`;
  await tx.query(
    `INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'issued', $12, $13)`,
    [id, tenantId, invoice.contractId, invoice.customerId, invoiceNumber(prefix, await nextSequence(tx, tenantId)), invoice.invoiceDate, invoice.dueDate, invoice.taxableMinor, invoice.gstRate, invoice.gstMinor, invoice.totalMinor, JSON.stringify(invoice.snapshot), issuedAt],
  );
  return id;
}

async function issue(tx: Tx, tenantId: string, input: InvoiceInput): Promise<TenantInvoice> {
  const amounts = invoiceAmounts(input);
  let customerId = input.customerId;
  if (input.contractId) {
    const { rows } = await tx.query<Row>('SELECT customer_id FROM contracts WHERE id = $1 AND tenant_id = $2', [input.contractId, tenantId]);
    if (!rows[0]) throw new Error(INVOICE_CONTRACT_MESSAGE);
    customerId = String(rows[0].customer_id);
  }
  if (!customerId) throw new Error('Choose a customer or contract.');
  const customer = await findCustomer(tx, tenantId, customerId);
  if (!customer) throw new Error(INVOICE_CUSTOMER_MESSAGE);
  const settings = await tenantSettings(tx, tenantId);
  const tax = invoiceTax(input, amounts, settings, customer);
  const snapshot = issuedInvoiceSnapshot(input, amounts, settings, customer, tax, await resolveFormat(tx, tenantId, input.formatId, customer.invoiceFormatId));
  const id = await insertInvoice(tx, tenantId, settings.invoicePrefix, { contractId: input.contractId ?? null, customerId, invoiceDate: input.invoiceDate, dueDate: input.dueDate, ...amounts, snapshot });
  return (await findInvoice(tx, tenantId, id))!;
}

export function createPgInvoiceMethods(db: Database) {
  return {
    /** The month filter is a half-open range of days on the date column, where SQLite matches a text prefix; a month that is not YYYY-MM is ignored, as there. */
    async listInvoices(context: TenantContext, query: InvoiceQuery = {}): Promise<InvoiceList> {
      const conditions = ['invoices.tenant_id = $1'];
      const values: unknown[] = [context.tenantId];
      const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
      const search = query.search?.trim().toLowerCase();
      if (search) where((p) => `(lower(invoices.invoice_number) LIKE ${p} ESCAPE '' OR lower(customers.company_name) LIKE ${p} ESCAPE '')`, `%${search}%`);
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
        const days = monthDays(query.month);
        if (!days) conditions.push('false');
        else { where((p) => `invoices.invoice_date >= ${p}`, days.start); where((p) => `invoices.invoice_date < ${p}`, days.end); }
      }
      if (query.status) where((p) => `invoices.status = ${p}`, query.status);
      const clause = conditions.join(' AND ');
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      return db.withTenant(context.tenantId, async (tx) => {
        const total = Number((await tx.query<Row>(`SELECT count(*) AS count FROM invoices JOIN customers ON customers.tenant_id = invoices.tenant_id AND customers.id = invoices.customer_id WHERE ${clause}`, values)).rows[0].count);
        const { rows } = await tx.query<Row>(`${invoiceWithCustomer} WHERE ${clause} ORDER BY invoices.invoice_date DESC, invoices.invoice_number COLLATE "C" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return { items: rows.map(parseInvoiceRow), total };
      });
    },
    async getGstSalesReport(context: TenantContext, month: string): Promise<GstSalesReport> {
      const days = reportMonthDays(month);
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>(
          `SELECT invoices.*, customers.company_name AS customer_name, customers.gstin AS customer_gstin
           FROM invoices JOIN customers ON customers.tenant_id = invoices.tenant_id AND customers.id = invoices.customer_id
           WHERE invoices.tenant_id = $1 AND invoices.invoice_date >= $2 AND invoices.invoice_date < $3 AND invoices.status <> 'void'
           ORDER BY invoices.invoice_date, invoices.invoice_number COLLATE "C"`,
          [context.tenantId, days.start, days.end],
        );
        return gstSalesReport(month, await tenantSettings(tx, context.tenantId), rows.map((row) => ({ invoice: parseInvoiceRow(row), customerGstin: String(row.customer_gstin) })));
      });
    },
    async getSupplyContext(context: TenantContext, query: { customerId?: string; customerGstin?: string; billingStateCode?: string }) {
      return db.withTenant(context.tenantId, async (tx) => {
        const settings = await tenantSettings(tx, context.tenantId);
        const customer = query.customerId ? await findCustomer(tx, context.tenantId, query.customerId) : null;
        if (query.customerId && !customer) throw new Error(INVOICE_CUSTOMER_MESSAGE);
        return resolveSupply(settings.stateCode, clientForSupply(customer, query.customerGstin, query.billingStateCode));
      });
    },
    /** Another tenant's invoice is invisible under row-level security, so it answers the same as one that does not exist. */
    async getInvoice(context: TenantContext, invoiceId: string): Promise<TenantInvoice | null> {
      return db.withTenant(context.tenantId, (tx) => findInvoice(tx, context.tenantId, invoiceId));
    },
    /** Locks the invoice before the checks, so a payment or a correction cannot land between them and the void. */
    async voidInvoice(context: TenantContext, invoiceId: string, reason: string): Promise<TenantInvoice> {
      return db.withTenant(context.tenantId, async (tx) => {
        const invoice = await findInvoice(tx, context.tenantId, invoiceId, true);
        const why = voidReason(invoice, reason);
        await tx.query(`UPDATE invoices SET status = 'void' WHERE id = $1 AND tenant_id = $2`, [invoiceId, context.tenantId]);
        await logFlow(tx, context.tenantId, `Invoice ${invoice!.invoiceNumber} voided: ${why}`);
        return (await findInvoice(tx, context.tenantId, invoiceId))!;
      });
    },
    /** Voids and replaces in one transaction, with the original locked first, so a refused replacement changes nothing and two corrections cannot both replace it. */
    async correctInvoice(context: TenantContext, invoiceId: string, correction: InvoiceInput, reason: string): Promise<TenantInvoice> {
      return db.withTenant(context.tenantId, async (tx) => {
        const current = await findInvoice(tx, context.tenantId, invoiceId, true);
        const why = correctionReason(current, reason);
        await tx.query(`UPDATE invoices SET status = 'void' WHERE id = $1 AND tenant_id = $2`, [invoiceId, context.tenantId]);
        const replacement = await issue(tx, context.tenantId, replacementInput(current!, correction, await existingFormatId(tx, context.tenantId, current!.snapshot.format?.id)));
        await logFlow(tx, context.tenantId, `Invoice ${current!.invoiceNumber} corrected as ${replacement.invoiceNumber}: ${why}`);
        return replacement;
      });
    },
    async createIssuedInvoice(context: TenantContext, input: InvoiceInput): Promise<TenantInvoice> {
      return db.withTenant(context.tenantId, (tx) => issue(tx, context.tenantId, input));
    },
  } satisfies Partial<TenantStore>;
}
