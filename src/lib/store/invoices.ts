import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { resolveSupply } from '../invoice-gst';
import { now } from './shared';
import { parseCustomerRow, parseInvoiceRow, parseSettingsRow } from './rows';
import { existingFormatId, resolveFormatForInvoice } from './invoice-formats';
import {
  clientForSupply, correctionReason, gstSalesReport, INVOICE_CONTRACT_MESSAGE, INVOICE_CUSTOMER_MESSAGE, invoiceAmounts, invoiceNumber, invoiceTax, issuedInvoiceSnapshot, replacementInput, reportMonthDays, voidReason,
} from './rules';
import type { TenantInvoice, InvoiceInput, InvoiceQuery, InvoiceList, GstSalesReport, TenantSettings } from './types';

type Row = Record<string, unknown>;

const invoiceWithCustomer = 'SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id';

export function createInvoiceMethods(database: DatabaseSync) {
  const settingsOf = (tenantId: string): TenantSettings => parseSettingsRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(tenantId) as Row);
  const customerOf = (tenantId: string, customerId: string) => { const row = database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId) as Row | undefined; return row ? parseCustomerRow(row) : null; };
  const log = (tenantId: string, message: string) => database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, 'feature-flow', message, now());
  function find(tenantId: string, invoiceId: string): TenantInvoice | null {
    const row = database.prepare(`${invoiceWithCustomer} WHERE invoices.id = ? AND invoices.tenant_id = ?`).get(invoiceId, tenantId) as Row | undefined;
    return row ? parseInvoiceRow(row) : null;
  }
  function inTransaction<T>(work: () => T): T {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  /** Issues one invoice. Numbers count the tenant's invoices, which one synchronous writer cannot interleave. */
  function issue(tenantId: string, input: InvoiceInput): TenantInvoice {
    const amounts = invoiceAmounts(input);
    let customerId = input.customerId;
    if (input.contractId) { const contract = database.prepare('SELECT customer_id FROM contracts WHERE id = ? AND tenant_id = ?').get(input.contractId, tenantId) as { customer_id: string } | undefined; if (!contract) throw new Error(INVOICE_CONTRACT_MESSAGE); customerId = contract.customer_id; }
    if (!customerId) throw new Error('Choose a customer or contract.');
    const customer = customerOf(tenantId, customerId);
    if (!customer) throw new Error(INVOICE_CUSTOMER_MESSAGE);
    const settings = settingsOf(tenantId);
    const tax = invoiceTax(input, amounts, settings, customer);
    const snapshot = issuedInvoiceSnapshot(input, amounts, settings, customer, tax, resolveFormatForInvoice(database, tenantId, input.formatId, customer.invoiceFormatId));
    const sequence = Number((database.prepare('SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ?').get(tenantId) as { count: number }).count) + 1;
    const id = `${tenantId}-invoice-${crypto.randomUUID()}`;
    database.prepare('INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(id, tenantId, input.contractId ?? null, customerId, invoiceNumber(settings.invoicePrefix, sequence), input.invoiceDate, input.dueDate, amounts.taxableMinor, amounts.gstRate, amounts.gstMinor, amounts.totalMinor, 'issued', JSON.stringify(snapshot), now());
    return find(tenantId, id)!;
  }
  return {
    listInvoices(context: TenantContext, query: InvoiceQuery = {}): InvoiceList {
      const conditions = ['invoices.tenant_id = ?']; const values: Array<string | number> = [context.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(invoices.invoice_number) LIKE ? OR lower(customers.company_name) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term); }
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) { conditions.push('substr(invoices.invoice_date, 1, 7) = ?'); values.push(query.month); }
      if (query.status) { conditions.push('invoices.status = ?'); values.push(query.status); }
      const where = conditions.join(' AND '); const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`${invoiceWithCustomer} WHERE ${where} ORDER BY invoices.invoice_date DESC, invoices.invoice_number DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: rows.map(parseInvoiceRow), total };
    },
    getGstSalesReport(context: TenantContext, month: string): GstSalesReport {
      reportMonthDays(month);
      const rows = database.prepare(`SELECT invoices.*, customers.company_name AS customer_name, customers.gstin AS customer_gstin
        FROM invoices JOIN customers ON customers.id = invoices.customer_id
        WHERE invoices.tenant_id = ? AND substr(invoices.invoice_date, 1, 7) = ? AND invoices.status != 'void'
        ORDER BY invoices.invoice_date, invoices.invoice_number`).all(context.tenantId, month) as Row[];
      return gstSalesReport(month, settingsOf(context.tenantId), rows.map((row) => ({ invoice: parseInvoiceRow(row), customerGstin: String(row.customer_gstin) })));
    },
    getSupplyContext(context: TenantContext, query: { customerId?: string; customerGstin?: string; billingStateCode?: string }) {
      const settings = settingsOf(context.tenantId);
      const customer = query.customerId ? customerOf(context.tenantId, query.customerId) : null;
      if (query.customerId && !customer) throw new Error(INVOICE_CUSTOMER_MESSAGE);
      return resolveSupply(settings.stateCode, clientForSupply(customer, query.customerGstin, query.billingStateCode));
    },
    /** Another tenant's invoice answers the same as one that does not exist. */
    getInvoice(context: TenantContext, invoiceId: string): TenantInvoice | null {
      return find(context.tenantId, invoiceId);
    },
    voidInvoice(context: TenantContext, invoiceId: string, reason: string): TenantInvoice {
      const invoice = find(context.tenantId, invoiceId);
      const why = voidReason(invoice, reason);
      inTransaction(() => {
        database.prepare("UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ?").run(invoiceId, context.tenantId);
        log(context.tenantId, `Invoice ${invoice!.invoiceNumber} voided: ${why}`);
      });
      return find(context.tenantId, invoiceId)!;
    },
    /** Voids the invoice and issues its replacement in one transaction, so a refused replacement leaves the original as it was. */
    correctInvoice(context: TenantContext, invoiceId: string, correction: InvoiceInput, reason: string): TenantInvoice {
      const current = find(context.tenantId, invoiceId);
      const why = correctionReason(current, reason);
      return inTransaction(() => {
        database.prepare("UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ?").run(invoiceId, context.tenantId);
        const replacement = issue(context.tenantId, replacementInput(current!, correction, existingFormatId(database, context.tenantId, current!.snapshot.format?.id)));
        log(context.tenantId, `Invoice ${current!.invoiceNumber} corrected as ${replacement.invoiceNumber}: ${why}`);
        return replacement;
      });
    },
    createIssuedInvoice(context: TenantContext, input: InvoiceInput): TenantInvoice {
      return issue(context.tenantId, input);
    },
  };
}
