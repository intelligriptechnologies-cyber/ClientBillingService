import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseInvoiceRow, parsePaymentRow, parseReminderRow } from './rows';
import { allocation, closeout, paymentApplied, paymentDetails, pendingPayment, reminderMessage, reminderNote } from './rules';
import type { TenantInvoice, TenantPayment, PaymentInput, PaymentQuery, PaymentList, PendingPayment, PaymentReminder } from './types';

type Row = Record<string, unknown>;

const paymentJoin = ' FROM payments JOIN invoices ON invoices.id = payments.invoice_id JOIN customers ON customers.id = invoices.customer_id';
const paymentColumns = 'payments.*, invoices.invoice_number, invoices.customer_id, customers.company_name AS customer_name';

export function createPaymentMethods(database: DatabaseSync) {
  const log = (tenantId: string, message: string, at = now()) => database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), tenantId, 'feature-flow', message, at);
  function invoiceOf(tenantId: string, invoiceId: string): TenantInvoice | null {
    const row = database.prepare('SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE invoices.id = ? AND invoices.tenant_id = ?').get(invoiceId, tenantId) as Row | undefined;
    return row ? parseInvoiceRow(row) : null;
  }
  function find(tenantId: string, paymentId: string): TenantPayment | null {
    const row = database.prepare(`SELECT ${paymentColumns}${paymentJoin} WHERE payments.id = ? AND payments.tenant_id = ?`).get(paymentId, tenantId) as Row | undefined;
    return row ? parsePaymentRow(row) : null;
  }
  function inTransaction<T>(work: () => T): T {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  /** Records the payment against the invoice it was checked against. Runs inside the caller's transaction. */
  function allocate(tenantId: string, invoice: TenantInvoice | null, input: PaymentInput, appliedMinor: number): string {
    const { paidMinor, status } = allocation(invoice, appliedMinor);
    const id = crypto.randomUUID(); const timestamp = now();
    database.prepare('INSERT INTO payments (id, tenant_id, invoice_id, payment_date, amount_minor, tds_minor, write_off_minor, method, reference, notes, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, tenantId, input.invoiceId, input.paymentDate, input.amountMinor, input.tdsMinor, input.writeOffMinor, input.method, input.reference?.trim() ?? '', input.notes?.trim() ?? '', timestamp);
    database.prepare('UPDATE invoices SET paid_minor = ?, status = ? WHERE id = ? AND tenant_id = ?').run(paidMinor, status, input.invoiceId, tenantId);
    log(tenantId, `Payment allocation recorded for ${invoice!.invoiceNumber}.`, timestamp);
    return id;
  }
  return {
    listPayments(context: TenantContext, query: PaymentQuery = {}): PaymentList {
      const conditions = ['payments.tenant_id = ?']; const values: Array<string | number> = [context.tenantId];
      if (query.customerId) { conditions.push('invoices.customer_id = ?'); values.push(query.customerId); }
      if (query.search?.trim()) { conditions.push('(lower(invoices.invoice_number) LIKE ? OR lower(customers.company_name) LIKE ? OR lower(payments.reference) LIKE ? OR lower(payments.notes) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term, term, term); }
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) { conditions.push('substr(payments.payment_date, 1, 7) = ?'); values.push(query.month); }
      const where = conditions.join(' AND '); const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const joined = `${paymentJoin} WHERE ${where}`;
      const total = Number((database.prepare(`SELECT COUNT(*) AS count${joined}`).get(...values) as { count: number }).count);
      const applied = Number((database.prepare(`SELECT COALESCE(SUM(payments.amount_minor + payments.tds_minor + payments.write_off_minor), 0) AS amount${joined}`).get(...values) as { amount: number }).amount);
      const rows = database.prepare(`SELECT ${paymentColumns}${joined} ORDER BY payments.payment_date DESC, payments.recorded_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: rows.map(parsePaymentRow), total, totalAppliedMinor: applied };
    },
    recordPayment(context: TenantContext, input: PaymentInput): TenantPayment {
      const appliedMinor = paymentApplied(input);
      const invoice = invoiceOf(context.tenantId, input.invoiceId);
      const id = inTransaction(() => allocate(context.tenantId, invoice, input, appliedMinor));
      return find(context.tenantId, id)!;
    },
    getPayment(context: TenantContext, paymentId: string): TenantPayment | null {
      return find(context.tenantId, paymentId);
    },
    updatePaymentDetails(context: TenantContext, paymentId: string, update: Pick<TenantPayment, 'method' | 'reference' | 'notes'>): TenantPayment {
      const payment = find(context.tenantId, paymentId);
      if (!payment) throw new Error('Payment not found.');
      const details = paymentDetails(update);
      inTransaction(() => {
        database.prepare('UPDATE payments SET method = ?, reference = ?, notes = ? WHERE id = ? AND tenant_id = ?').run(details.method, details.reference, details.notes, paymentId, context.tenantId);
        log(context.tenantId, `Payment details updated for ${payment.invoiceNumber}. Amount and allocation were unchanged.`);
      });
      return find(context.tenantId, paymentId)!;
    },
    /** Writes off the outstanding balance and records why, in one transaction. */
    closeInvoice(context: TenantContext, invoiceId: string, note = ''): TenantPayment {
      const invoice = invoiceOf(context.tenantId, invoiceId);
      const input = { invoiceId, ...closeout(invoice, note) };
      const id = inTransaction(() => {
        const paymentId = allocate(context.tenantId, invoice!, input, paymentApplied(input));
        log(context.tenantId, `Invoice ${invoice!.invoiceNumber} was closed from Pending payments; outstanding balance was written off.`);
        return paymentId;
      });
      return find(context.tenantId, id)!;
    },
    listPendingPayments(context: TenantContext): PendingPayment[] {
      const rows = database.prepare('SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE invoices.tenant_id = ? AND invoices.status != \'void\' AND invoices.paid_minor < invoices.total_minor ORDER BY invoices.due_date ASC').all(context.tenantId) as Row[];
      const reminders = database.prepare('SELECT * FROM payment_reminders WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC');
      return rows.map((row) => { const invoice = parseInvoiceRow(row); return pendingPayment(invoice, (reminders.all(invoice.id, context.tenantId) as Row[]).map(parseReminderRow)); });
    },
    recordPaymentReminder(context: TenantContext, invoiceId: string, input: { channel: PaymentReminder['channel']; note?: string }): PaymentReminder {
      const invoice = invoiceOf(context.tenantId, invoiceId);
      const note = reminderNote(invoice, input);
      const id = crypto.randomUUID(); const timestamp = now();
      inTransaction(() => {
        database.prepare('INSERT INTO payment_reminders (id, tenant_id, invoice_id, channel, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, context.tenantId, invoiceId, input.channel, note, timestamp);
        log(context.tenantId, reminderMessage(input.channel, invoice!.invoiceNumber), timestamp);
      });
      return parseReminderRow(database.prepare('SELECT * FROM payment_reminders WHERE id = ? AND tenant_id = ?').get(id, context.tenantId) as Row);
    },
  };
}
