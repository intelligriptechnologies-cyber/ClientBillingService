import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import { serviceFromRow } from './services';
import type { AppSession, BillingFrequency, QuotationLine, Quotation, QuotationInput } from './types';

function quotationFromRow(database: DatabaseSync, row: Record<string, unknown>): Quotation {
  const lines = (database.prepare('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY id').all(String(row.id)) as Record<string, unknown>[]).map((line) => ({
    id: String(line.id), serviceId: String(line.service_id), serviceName: String(line.service_name), frequency: line.frequency as BillingFrequency, quantity: Number(line.quantity), unitPriceMinor: Number(line.unit_price_minor), lineTotalMinor: Number(line.line_total_minor),
  }));
  return { id: String(row.id), quoteNumber: String(row.quote_number), customerName: String(row.customer_name), customerEmail: row.customer_email ? String(row.customer_email) : null, status: row.archived_at ? 'archived' : 'draft', lines, totalMinor: Number(row.total_minor), createdAt: String(row.created_at) };
}

export function createQuotationMethods(database: DatabaseSync) {
  return {
    listQuotations(session: AppSession): Quotation[] {
      requireTenantMember(session);
      return (database.prepare('SELECT * FROM quotations WHERE tenant_id = ? ORDER BY created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map((row) => quotationFromRow(database, row));
    },
    getQuotation(session: AppSession, quotationId: string): Quotation | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (row.tenant_id !== session.tenantId) throw new Error('This quotation does not belong to your tenant.');
      return quotationFromRow(database, row);
    },
    createQuotation(session: AppSession, input: QuotationInput): Quotation {
      requireTenantMember(session);
      const customerName = input.customerName.trim();
      if (!customerName || !input.lines.length) throw new Error('Choose a customer name and at least one service.');
      const quoteId = `${session.tenantId}-quote-${crypto.randomUUID()}`;
      const serviceStatement = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\'');
      const lines = input.lines.map((line, index): QuotationLine => {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Quotation quantities must be positive whole numbers.');
        if (!['monthly', 'quarterly', 'halfYearly', 'annual'].includes(line.frequency)) throw new Error('Choose a supported billing frequency.');
        const service = serviceStatement.get(line.serviceId, session.tenantId) as Record<string, unknown> | undefined;
        if (!service) throw new Error('A quotation service must belong to your tenant and be active.');
        const prices = serviceFromRow(service).prices;
        return { id: `${quoteId}-line-${index + 1}`, serviceId: line.serviceId, serviceName: String(service.name), frequency: line.frequency, quantity: line.quantity, unitPriceMinor: prices[line.frequency], lineTotalMinor: prices[line.frequency] * line.quantity };
      });
      const totalMinor = lines.reduce((total, line) => total + line.lineTotalMinor, 0);
      const sequence = Number((database.prepare('SELECT COUNT(*) AS count FROM quotations WHERE tenant_id = ?').get(session.tenantId) as { count: number }).count) + 1;
      const quoteNumber = `Q-${session.tenantId.toUpperCase()}-${String(sequence).padStart(4, '0')}`;
      const now = new Date().toISOString();
      database.exec('BEGIN');
      try {
        database.prepare(`INSERT INTO quotations (id, tenant_id, quote_number, customer_name, customer_email, status, total_minor, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
          .run(quoteId, session.tenantId, quoteNumber, customerName, input.customerEmail?.trim() || null, totalMinor, now);
        const insertLine = database.prepare('INSERT INTO quotation_lines (id, quotation_id, service_id, service_name, frequency, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const line of lines) insertLine.run(line.id, quoteId, line.serviceId, line.serviceName, line.frequency, line.quantity, line.unitPriceMinor, line.lineTotalMinor);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return quotationFromRow(database, database.prepare('SELECT * FROM quotations WHERE id = ?').get(quoteId) as Record<string, unknown>);
    },
    updateQuotation(session: AppSession, quotationId: string, update: Partial<QuotationInput> & { status?: Quotation['status'] }): Quotation {
      requireTenantMember(session);
      const current = this.getQuotation(session, quotationId);
      if (!current) throw new Error('Quotation not found.');
      if (update.status !== undefined) {
        if (update.status !== 'draft' && update.status !== 'archived') throw new Error('Invalid quotation status.');
        database.prepare('UPDATE quotations SET archived_at = ? WHERE id = ? AND tenant_id = ?').run(update.status === 'archived' ? now() : null, quotationId, session.tenantId);
        return this.getQuotation(session, quotationId)!;
      }
      if (current.status === 'archived') throw new Error('Restore an archived quotation before editing it.');
      const customerName = (update.customerName ?? current.customerName).trim();
      const customerEmail = (update.customerEmail ?? current.customerEmail ?? '').trim();
      const inputLines = update.lines ?? current.lines.map((line) => ({ serviceId: line.serviceId, frequency: line.frequency, quantity: line.quantity }));
      if (!customerName || !inputLines.length) throw new Error('Choose a customer name and at least one service.');
      const serviceStatement = database.prepare("SELECT * FROM services WHERE id = ? AND tenant_id = ? AND status = 'active'");
      const lines = inputLines.map((line, index): QuotationLine => {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Quotation quantities must be positive whole numbers.');
        if (!['monthly', 'quarterly', 'halfYearly', 'annual'].includes(line.frequency)) throw new Error('Choose a supported billing frequency.');
        const service = serviceStatement.get(line.serviceId, session.tenantId) as Record<string, unknown> | undefined;
        if (!service) throw new Error('A quotation service must belong to your tenant and be active.');
        const price = serviceFromRow(service).prices[line.frequency];
        return { id: `${quotationId}-line-${index + 1}`, serviceId: line.serviceId, serviceName: String(service.name), frequency: line.frequency, quantity: line.quantity, unitPriceMinor: price, lineTotalMinor: price * line.quantity };
      });
      database.exec('BEGIN');
      try {
        database.prepare('UPDATE quotations SET customer_name = ?, customer_email = ?, total_minor = ? WHERE id = ? AND tenant_id = ?').run(customerName, customerEmail || null, lines.reduce((sum, line) => sum + line.lineTotalMinor, 0), quotationId, session.tenantId);
        database.prepare('DELETE FROM quotation_lines WHERE quotation_id = ?').run(quotationId);
        const insertLine = database.prepare('INSERT INTO quotation_lines (id, quotation_id, service_id, service_name, frequency, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const line of lines) insertLine.run(line.id, quotationId, line.serviceId, line.serviceName, line.frequency, line.quantity, line.unitPriceMinor, line.lineTotalMinor);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return this.getQuotation(session, quotationId)!;
    },
  };
}
