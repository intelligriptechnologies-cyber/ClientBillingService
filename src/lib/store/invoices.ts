import type { DatabaseSync } from 'node:sqlite';
import { gstr1Section, validateGstin } from '../gst';
import { gstSnapshotFields, parseBillingState, parseGstin, resolveSupply } from '../invoice-gst';
import { calculateInvoiceLines } from '../invoice-lines';
import { now, requireTenantMember } from './shared';
import { settingsFromRow } from './settings';
import { existingFormatId, resolveFormatForInvoice } from './invoice-formats';
import type { AppSession, InvoiceStatus, InvoiceSnapshot, TenantInvoice, InvoiceInput, InvoiceQuery, InvoiceList, GstSalesRow, GstSalesReport, HsnSummaryRow } from './types';

export function invoiceFromRow(row: Record<string, unknown>): TenantInvoice {
  return { id: String(row.id), tenantId: String(row.tenant_id), contractId: row.contract_id ? String(row.contract_id) : null, customerId: String(row.customer_id), customerName: String(row.customer_name), invoiceNumber: String(row.invoice_number), invoiceDate: String(row.invoice_date), dueDate: String(row.due_date), taxableMinor: Number(row.taxable_minor), gstRate: Number(row.gst_rate), gstMinor: Number(row.gst_minor), totalMinor: Number(row.total_minor), paidMinor: Number(row.paid_minor), status: row.status as InvoiceStatus, snapshot: JSON.parse(String(row.snapshot)) as InvoiceSnapshot, issuedAt: String(row.issued_at) };
}
function gstState(gstin: string) { return /^\d{2}/.test(gstin.trim()) ? gstin.trim().slice(0, 2) : null; }
function gstSalesRowFromInvoice(row: Record<string, unknown>, companyGstin: string): GstSalesRow {
  const snapshot = JSON.parse(String(row.snapshot)) as InvoiceSnapshot;
  const customerGstin = snapshot.customerGstin ?? String(row.customer_gstin);
  const gstMinor = Number(row.gst_minor); const totalMinor = Number(row.total_minor);
  const interstate = snapshot.taxSplit ? snapshot.taxSplit === 'inter' : Boolean(gstState(companyGstin) && gstState(customerGstin) && gstState(companyGstin) !== gstState(customerGstin));
  const igstMinor = snapshot.lines?.length ? snapshot.lines.filter((line) => line.taxType === 'igst').reduce((sum, line) => sum + line.gstMinor, 0) : interstate ? gstMinor : 0;
  const domesticGstMinor = gstMinor - igstMinor;
  const cgstMinor = Math.floor(domesticGstMinor / 2); const sgstMinor = domesticGstMinor - cgstMinor;
  const taxable = snapshot.documentType ? snapshot.documentType === 'Tax Invoice' : gstMinor > 0;
  const registration = validateGstin(customerGstin);
  const section = gstr1Section({ taxability: taxable ? 'taxable' : 'nil', clientRegistered: registration.ok && registration.registered, split: interstate ? 'inter' : 'intra', invoiceTotalMinor: totalMinor });
  return { section, invoiceId: String(row.id), invoiceNumber: String(row.invoice_number), invoiceDate: String(row.invoice_date), customerName: String(row.customer_name), customerGstin, taxableMinor: Number(row.taxable_minor), gstMinor, totalMinor, igstMinor, cgstMinor, sgstMinor, netGstMinor: gstMinor };
}
/** One row per HSN/SAC code across the month's lines. Lines without a code (older invoices, optional codes) are left out. */
function hsnSummaryFromRows(rows: Record<string, unknown>[]): HsnSummaryRow[] {
  const byCode = new Map<string, HsnSummaryRow>();
  for (const row of rows) {
    for (const line of (JSON.parse(String(row.snapshot)) as InvoiceSnapshot).lines ?? []) {
      if (!line.hsnSac) continue;
      const current = byCode.get(line.hsnSac) ?? { hsn: line.hsnSac, description: line.description, quantity: 0, taxableMinor: 0, taxMinor: 0 };
      byCode.set(line.hsnSac, { ...current, quantity: Math.round((current.quantity + line.quantity) * 1000) / 1000, taxableMinor: current.taxableMinor + line.amountMinor, taxMinor: current.taxMinor + line.gstMinor });
    }
  }
  return [...byCode.values()].sort((a, b) => a.hsn.localeCompare(b.hsn));
}
/** The state a client supplies to: the typed GSTIN when it differs from the stored one, otherwise what the client record holds. */
function clientForSupply(customer: Record<string, unknown> | undefined, typedGstin: string | undefined, billingStateCode?: string) {
  const stored = customer ? String(customer.gstin).trim().toUpperCase() : '';
  const typed = typedGstin?.trim().toUpperCase() ?? '';
  const storedState = customer ? String(customer.state_code) : parseBillingState(billingStateCode);
  if (!typed || typed === stored) return { gstin: stored, stateCode: storedState };
  const registration = parseGstin(typed, 'customer GST number');
  return { gstin: registration.gstin, stateCode: registration.gstin ? registration.stateCode : storedState };
}

export function createInvoiceMethods(database: DatabaseSync) {
  return {
    listInvoices(session: AppSession, query: InvoiceQuery = {}): InvoiceList {
      requireTenantMember(session);
      const conditions = ['invoices.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(invoices.invoice_number) LIKE ? OR lower(customers.company_name) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term); }
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) { conditions.push('substr(invoices.invoice_date, 1, 7) = ?'); values.push(query.month); }
      if (query.status) { conditions.push('invoices.status = ?'); values.push(query.status); }
      const where = conditions.join(' AND '); const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE ${where}`).get(...values) as { count: number }).count);
      const rows = database.prepare(`SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE ${where} ORDER BY invoices.invoice_date DESC, invoices.invoice_number DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(invoiceFromRow), total };
    },
    getGstSalesReport(session: AppSession, month: string): GstSalesReport {
      requireTenantMember(session);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid report month.');
      const settings = settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>);
      const rows = database.prepare(`SELECT invoices.*, customers.company_name AS customer_name, customers.gstin AS customer_gstin
        FROM invoices JOIN customers ON customers.id = invoices.customer_id
        WHERE invoices.tenant_id = ? AND substr(invoices.invoice_date, 1, 7) = ? AND invoices.status != 'void'
        ORDER BY invoices.invoice_date, invoices.invoice_number`).all(session.tenantId, month) as Record<string, unknown>[];
      const items = rows.map((row) => gstSalesRowFromInvoice(row, settings.gstin));
      const totals = items.reduce((total, item) => ({ taxableMinor: total.taxableMinor + item.taxableMinor, gstMinor: total.gstMinor + item.gstMinor, totalMinor: total.totalMinor + item.totalMinor, igstMinor: total.igstMinor + item.igstMinor, cgstMinor: total.cgstMinor + item.cgstMinor, sgstMinor: total.sgstMinor + item.sgstMinor, netGstMinor: total.netGstMinor + item.netGstMinor }), { taxableMinor: 0, gstMinor: 0, totalMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0, netGstMinor: 0 });
      return { month, companyName: settings.companyName, gstin: settings.gstin, items, hsnSummary: hsnSummaryFromRows(rows), totals };
    },
    getSupplyContext(session: AppSession, query: { customerId?: string; customerGstin?: string; billingStateCode?: string }) {
      requireTenantMember(session);
      const settings = settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>);
      const customer = query.customerId ? database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(query.customerId, session.tenantId) as Record<string, unknown> | undefined : undefined;
      if (query.customerId && !customer) throw new Error('The selected customer must belong to your tenant.');
      return resolveSupply(settings.stateCode, clientForSupply(customer, query.customerGstin, query.billingStateCode));
    },
    getInvoice(session: AppSession, invoiceId: string): TenantInvoice | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE invoices.id = ?').get(invoiceId) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (row.tenant_id !== session.tenantId) throw new Error('This invoice does not belong to your tenant.');
      return invoiceFromRow(row);
    },
    voidInvoice(session: AppSession, invoiceId: string, reason: string): TenantInvoice {
      requireTenantMember(session);
      const invoice = this.getInvoice(session, invoiceId);
      if (!invoice) throw new Error('Invoice not found.');
      if (invoice.status === 'void') throw new Error('This invoice is already void.');
      if (invoice.paidMinor > 0) throw new Error('An invoice with recorded payments cannot be voided.');
      if (!reason.trim()) throw new Error('Enter a reason for voiding the invoice.');
      database.exec('BEGIN');
      try {
        database.prepare("UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ?").run(invoiceId, session.tenantId);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Invoice ${invoice.invoiceNumber} voided: ${reason.trim()}`, now());
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return this.getInvoice(session, invoiceId)!;
    },
    correctInvoice(session: AppSession, invoiceId: string, correction: InvoiceInput, reason: string): TenantInvoice {
      requireTenantMember(session);
      const current = this.getInvoice(session, invoiceId);
      if (!current) throw new Error('Invoice not found.');
      if (current.status === 'void') throw new Error('A void invoice cannot be corrected.');
      if (current.paidMinor > 0) throw new Error('An invoice with recorded payments cannot be corrected.');
      if (!reason.trim()) throw new Error('Enter a correction reason.');
      database.exec('BEGIN');
      try {
        database.prepare("UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ?").run(invoiceId, session.tenantId);
        const replacement = this.createIssuedInvoice(session, { ...correction, contractId: current.contractId ?? undefined, customerId: current.customerId, venue: correction.venue ?? current.snapshot.venue, customerPan: correction.customerPan ?? current.snapshot.customerPan, customerGstin: correction.customerGstin ?? current.snapshot.customerGstin, billingAddress: correction.billingAddress ?? current.snapshot.customerAddress, gstApplicable: correction.gstApplicable ?? current.snapshot.gstApplicable, notes: correction.notes ?? current.snapshot.notes, formatId: correction.formatId ?? existingFormatId(database, session.tenantId, current.snapshot.format?.id) });
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Invoice ${current.invoiceNumber} corrected as ${replacement.invoiceNumber}: ${reason.trim()}`, now());
        database.exec('COMMIT');
        return replacement;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    createIssuedInvoice(session: AppSession, input: InvoiceInput): TenantInvoice {
      requireTenantMember(session);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate < input.invoiceDate) throw new Error('Enter valid invoice and due dates.');
      const totals = input.lines ? calculateInvoiceLines(input.lines) : null;
      if (!totals && (!Number.isInteger(input.taxableMinor) || (input.taxableMinor ?? -1) < 0)) throw new Error('Taxable amount must be a non-negative whole minor amount.');
      const gstRate = totals ? (totals.taxableMinor ? Math.round(totals.gstMinor / totals.taxableMinor * 10000) / 100 : 0) : input.gstRate ?? 0;
      if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error('GST rate must be between 0 and 100.');
      if (input.gstApplicable === false && totals?.gstMinor) throw new Error('Turn on GST applicable before adding taxed lines.');
      if (input.customerPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.customerPan.trim().toUpperCase())) throw new Error('Enter a valid customer PAN.');
      let customerId = input.customerId;
      if (input.contractId) { const contract = database.prepare('SELECT customer_id FROM contracts WHERE id = ? AND tenant_id = ?').get(input.contractId, session.tenantId) as { customer_id: string } | undefined; if (!contract) throw new Error('The selected contract must belong to your tenant.'); customerId = contract.customer_id; }
      if (!customerId) throw new Error('Choose a customer or contract.');
      const customer = database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown> | undefined;
      if (!customer) throw new Error('The selected customer must belong to your tenant.');
      const settings = settingsFromRow(database.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(session.tenantId) as Record<string, unknown>);
      const supply = resolveSupply(settings.stateCode, clientForSupply(customer, input.customerGstin));
      const syntheticTaxType = supply.expectedTaxType ?? 'igst';
      const gstFields = gstSnapshotFields({ seller: settings, supply, lines: totals ? totals.lines : [{ taxType: gstRate > 0 ? syntheticTaxType : 'none', gstRate }], requireHsn: Boolean(totals), overrideReason: input.taxSplitOverrideReason });
      const sequence = Number((database.prepare('SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ?').get(session.tenantId) as { count: number }).count) + 1;
      const taxableMinor = totals?.taxableMinor ?? input.taxableMinor!; const gstMinor = totals?.gstMinor ?? Math.round(taxableMinor * gstRate / 100); const timestamp = now(); const id = `${session.tenantId}-invoice-${crypto.randomUUID()}`;
      const snapshot: InvoiceSnapshot = { companyName: settings.companyName, gstin: settings.gstin, address: settings.address, logoDataUrl: settings.logoDataUrl, stampDataUrl: settings.stampDataUrl, signatureDataUrl: settings.signatureDataUrl, customerName: String(customer.company_name), customerEmail: String(customer.email), customerAddress: input.billingAddress?.trim() || String(customer.billing_address), customerPan: input.customerPan?.trim().toUpperCase() || undefined, customerGstin: input.customerGstin?.trim().toUpperCase() || String(customer.gstin), venue: input.venue?.trim(), gstApplicable: input.gstApplicable ?? gstMinor > 0, notes: input.notes?.trim(), lines: totals?.lines, gstRate, footer: settings.footer, invoiceTemplate: settings.invoiceTemplate, format: resolveFormatForInvoice(database, session.tenantId, input.formatId), ...gstFields };
      const number = `${settings.invoicePrefix}-${String(sequence).padStart(4, '0')}`;
      database.prepare('INSERT INTO invoices (id, tenant_id, contract_id, customer_id, invoice_number, invoice_date, due_date, taxable_minor, gst_rate, gst_minor, total_minor, paid_minor, status, snapshot, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)').run(id, session.tenantId, input.contractId ?? null, customerId, number, input.invoiceDate, input.dueDate, taxableMinor, gstRate, gstMinor, taxableMinor + gstMinor, 'issued', JSON.stringify(snapshot), timestamp);
      return this.getInvoice(session, id)!;
    },
  };
}
