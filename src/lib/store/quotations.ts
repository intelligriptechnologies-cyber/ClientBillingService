import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseQuotationLineRow, parseQuotationRow, parseServiceRow } from './rows';
import { checkQuotationLine, FOREIGN_QUOTATION_MESSAGE, pricedQuotationLine, QUOTATION_SERVICE_MESSAGE, quotationCustomer, quotationTotal, quoteNumber } from './rules';
import type { QuotationLine, Quotation, QuotationInput } from './types';

type Row = Record<string, unknown>;

export function createQuotationMethods(database: DatabaseSync) {
  function withLines(row: Row): Quotation {
    const lines = (database.prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY id').all(String(row.id)) as Row[]).map(parseQuotationLineRow);
    return parseQuotationRow(row, lines);
  }
  /** A quotation another tenant owns answers the same as one that does not exist. */
  function find(tenantId: string, quotationId: string): Quotation {
    const row = database.prepare('SELECT * FROM quotations WHERE id = ? AND tenant_id = ?').get(quotationId, tenantId) as Row | undefined;
    if (!row) throw new Error(FOREIGN_QUOTATION_MESSAGE);
    return withLines(row);
  }
  function priceLines(tenantId: string, quotationId: string, input: QuotationInput['lines']): QuotationLine[] {
    const service = database.prepare("SELECT * FROM services WHERE id = ? AND tenant_id = ? AND status = 'active'");
    return input.map((line, index) => {
      checkQuotationLine(line);
      const row = service.get(line.serviceId, tenantId) as Row | undefined;
      if (!row) throw new Error(QUOTATION_SERVICE_MESSAGE);
      return pricedQuotationLine(quotationId, index, line, parseServiceRow(row));
    });
  }
  function insertLines(quotationId: string, lines: QuotationLine[]) {
    const insert = database.prepare('INSERT INTO quotation_lines (id, quotation_id, service_id, service_name, frequency, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const line of lines) insert.run(line.id, quotationId, line.serviceId, line.serviceName, line.frequency, line.quantity, line.unitPriceMinor, line.lineTotalMinor);
  }
  function inTransaction(work: () => void) {
    database.exec('BEGIN');
    try { work(); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return {
    listQuotations(context: TenantContext): Quotation[] {
      return (database.prepare('SELECT * FROM quotations WHERE tenant_id = ? ORDER BY created_at DESC, id').all(context.tenantId) as Row[]).map(withLines);
    },
    getQuotation(context: TenantContext, quotationId: string): Quotation {
      return find(context.tenantId, quotationId);
    },
    createQuotation(context: TenantContext, input: QuotationInput): Quotation {
      const customer = quotationCustomer(input.customerName, input.customerEmail, input.lines);
      const quoteId = `${context.tenantId}-quote-${crypto.randomUUID()}`;
      const lines = priceLines(context.tenantId, quoteId, input.lines);
      const sequence = Number((database.prepare('SELECT COUNT(*) AS count FROM quotations WHERE tenant_id = ?').get(context.tenantId) as { count: number }).count) + 1;
      inTransaction(() => {
        database.prepare(`INSERT INTO quotations (id, tenant_id, quote_number, customer_name, customer_email, status, total_minor, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
          .run(quoteId, context.tenantId, quoteNumber(context.tenantId, sequence), customer.customerName, customer.customerEmail, quotationTotal(lines), now());
        insertLines(quoteId, lines);
      });
      return find(context.tenantId, quoteId);
    },
    updateQuotation(context: TenantContext, quotationId: string, update: Partial<QuotationInput> & { status?: Quotation['status'] }): Quotation {
      const current = find(context.tenantId, quotationId);
      if (update.status !== undefined) {
        if (update.status !== 'draft' && update.status !== 'archived') throw new Error('Invalid quotation status.');
        database.prepare('UPDATE quotations SET archived_at = ? WHERE id = ? AND tenant_id = ?').run(update.status === 'archived' ? now() : null, quotationId, context.tenantId);
        return find(context.tenantId, quotationId);
      }
      if (current.status === 'archived') throw new Error('Restore an archived quotation before editing it.');
      const inputLines = update.lines ?? current.lines.map((line) => ({ serviceId: line.serviceId, frequency: line.frequency, quantity: line.quantity }));
      const customer = quotationCustomer(update.customerName ?? current.customerName, update.customerEmail ?? current.customerEmail, inputLines);
      const lines = priceLines(context.tenantId, quotationId, inputLines);
      inTransaction(() => {
        database.prepare('UPDATE quotations SET customer_name = ?, customer_email = ?, total_minor = ? WHERE id = ? AND tenant_id = ?').run(customer.customerName, customer.customerEmail, quotationTotal(lines), quotationId, context.tenantId);
        database.prepare('DELETE FROM quotation_lines WHERE quotation_id = ?').run(quotationId);
        insertLines(quotationId, lines);
      });
      return find(context.tenantId, quotationId);
    },
  };
}
