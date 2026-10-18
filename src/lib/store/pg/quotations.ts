import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseQuotationLineRow, parseQuotationRow, parseServiceRow } from '../rows';
import { checkQuotationLine, FOREIGN_QUOTATION_MESSAGE, pricedQuotationLine, QUOTATION_SERVICE_MESSAGE, quotationCustomer, quotationTotal, quoteNumber } from '../rules';
import { now } from '../shared';
import type { Quotation, QuotationInput, QuotationLine, TenantStore } from '../types';

type Row = Record<string, unknown>;
type QuotationUpdate = Partial<QuotationInput> & { status?: Quotation['status'] };

/** Line ids end in their position, so "C" ordering is SQLite's: line-10 sorts before line-2. */
async function withLines(tx: Tx, tenantId: string, rows: Row[]): Promise<Quotation[]> {
  if (!rows.length) return [];
  const lines = await tx.query<Row>('SELECT * FROM quotation_lines WHERE tenant_id = $1 AND quotation_id = ANY($2) ORDER BY id COLLATE "C"', [tenantId, rows.map((row) => row.id)]);
  return rows.map((row) => parseQuotationRow(row, lines.rows.filter((line) => line.quotation_id === row.id).map(parseQuotationLineRow)));
}

/** A quotation another tenant owns is invisible under row-level security, so it answers the same as one that does not exist. */
async function find(tx: Tx, tenantId: string, quotationId: string, forUpdate = false): Promise<Quotation> {
  const { rows } = await tx.query<Row>(`SELECT * FROM quotations WHERE id = $1 AND tenant_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [quotationId, tenantId]);
  if (!rows[0]) throw new Error(FOREIGN_QUOTATION_MESSAGE);
  return (await withLines(tx, tenantId, rows))[0];
}

async function priceLines(tx: Tx, tenantId: string, quotationId: string, input: QuotationInput['lines']): Promise<QuotationLine[]> {
  const lines: QuotationLine[] = [];
  for (const [index, line] of input.entries()) {
    checkQuotationLine(line);
    const { rows } = await tx.query<Row>(`SELECT * FROM services WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [line.serviceId, tenantId]);
    if (!rows[0]) throw new Error(QUOTATION_SERVICE_MESSAGE);
    lines.push(pricedQuotationLine(quotationId, index, line, parseServiceRow(rows[0])));
  }
  return lines;
}

async function insertLines(tx: Tx, tenantId: string, quotationId: string, lines: QuotationLine[]) {
  for (const line of lines) {
    await tx.query('INSERT INTO quotation_lines (id, tenant_id, quotation_id, service_id, service_name, frequency, quantity, unit_price_minor, line_total_minor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [line.id, tenantId, quotationId, line.serviceId, line.serviceName, line.frequency, line.quantity, line.unitPriceMinor, line.lineTotalMinor]);
  }
}

export function createPgQuotationMethods(db: Database) {
  return {
    async listQuotations(context: TenantContext): Promise<Quotation[]> {
      return db.withTenant(context.tenantId, async (tx) => withLines(tx, context.tenantId, (await tx.query<Row>('SELECT * FROM quotations WHERE tenant_id = $1 ORDER BY created_at DESC, id COLLATE "C"', [context.tenantId])).rows));
    },
    async getQuotation(context: TenantContext, quotationId: string): Promise<Quotation> {
      return db.withTenant(context.tenantId, (tx) => find(tx, context.tenantId, quotationId));
    },
    /**
     * Quote numbers count the tenant's quotations. FOR UPDATE on the tenant's settings row, which every tenant has,
     * makes two creates take turns, so the second counts the first instead of reusing its number.
     */
    async createQuotation(context: TenantContext, input: QuotationInput): Promise<Quotation> {
      const customer = quotationCustomer(input.customerName, input.customerEmail, input.lines);
      const quoteId = `${context.tenantId}-quote-${crypto.randomUUID()}`;
      return db.withTenant(context.tenantId, async (tx) => {
        const lines = await priceLines(tx, context.tenantId, quoteId, input.lines);
        await tx.query('SELECT 1 FROM tenant_settings WHERE tenant_id = $1 FOR UPDATE', [context.tenantId]);
        const sequence = Number((await tx.query<Row>('SELECT count(*) AS count FROM quotations WHERE tenant_id = $1', [context.tenantId])).rows[0].count) + 1;
        await tx.query(`INSERT INTO quotations (id, tenant_id, quote_number, customer_name, customer_email, status, total_minor, created_at) VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7)`,
          [quoteId, context.tenantId, quoteNumber(context.tenantId, sequence), customer.customerName, customer.customerEmail, quotationTotal(lines), now()]);
        await insertLines(tx, context.tenantId, quoteId, lines);
        return find(tx, context.tenantId, quoteId);
      });
    },
    /** Locks the quotation first, so an edit sees an archive that committed before it and two edits replace the lines one after the other. */
    async updateQuotation(context: TenantContext, quotationId: string, update: QuotationUpdate): Promise<Quotation> {
      return db.withTenant(context.tenantId, async (tx) => {
        const current = await find(tx, context.tenantId, quotationId, true);
        if (update.status !== undefined) {
          if (update.status !== 'draft' && update.status !== 'archived') throw new Error('Invalid quotation status.');
          await tx.query('UPDATE quotations SET archived_at = $1 WHERE id = $2 AND tenant_id = $3', [update.status === 'archived' ? now() : null, quotationId, context.tenantId]);
          return find(tx, context.tenantId, quotationId);
        }
        if (current.status === 'archived') throw new Error('Restore an archived quotation before editing it.');
        const inputLines = update.lines ?? current.lines.map((line) => ({ serviceId: line.serviceId, frequency: line.frequency, quantity: line.quantity }));
        const customer = quotationCustomer(update.customerName ?? current.customerName, update.customerEmail ?? current.customerEmail, inputLines);
        const lines = await priceLines(tx, context.tenantId, quotationId, inputLines);
        await tx.query('UPDATE quotations SET customer_name = $1, customer_email = $2, total_minor = $3 WHERE id = $4 AND tenant_id = $5', [customer.customerName, customer.customerEmail, quotationTotal(lines), quotationId, context.tenantId]);
        await tx.query('DELETE FROM quotation_lines WHERE quotation_id = $1 AND tenant_id = $2', [quotationId, context.tenantId]);
        await insertLines(tx, context.tenantId, quotationId, lines);
        return find(tx, context.tenantId, quotationId);
      });
    },
  } satisfies Partial<TenantStore>;
}
