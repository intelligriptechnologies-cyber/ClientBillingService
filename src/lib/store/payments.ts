import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import { invoiceFromRow } from './invoices';
import type { AppSession, InvoiceStatus, PaymentMethod, TenantPayment, PaymentInput, PaymentQuery, PaymentList, PendingPayment, PaymentReminder } from './types';

function paymentFromRow(row: Record<string, unknown>): TenantPayment {
  const amountMinor = Number(row.amount_minor); const tdsMinor = Number(row.tds_minor); const writeOffMinor = Number(row.write_off_minor);
  return { id: String(row.id), invoiceId: String(row.invoice_id), invoiceNumber: String(row.invoice_number), customerId: String(row.customer_id), customerName: String(row.customer_name), paymentDate: String(row.payment_date), amountMinor, tdsMinor, writeOffMinor, appliedMinor: amountMinor + tdsMinor + writeOffMinor, method: row.method as PaymentMethod, reference: String(row.reference), notes: String(row.notes), recordedAt: String(row.recorded_at) };
}
function reminderFromRow(row: Record<string, unknown>): PaymentReminder { return { id: String(row.id), invoiceId: String(row.invoice_id), channel: row.channel as PaymentReminder['channel'], note: String(row.note), createdAt: String(row.created_at) }; }
function daysLate(dueDate: string, today = new Date().toISOString().slice(0, 10)) { const [year, month, day] = dueDate.split('-').map(Number); const [todayYear, todayMonth, todayDay] = today.split('-').map(Number); return Math.max(0, Math.floor((Date.UTC(todayYear, todayMonth - 1, todayDay) - Date.UTC(year, month - 1, day)) / 86_400_000)); }
function agingFor(days: number): PendingPayment['agingBucket'] { if (days === 0) return 'Current'; if (days <= 30) return '1–30'; if (days <= 60) return '31–60'; if (days <= 90) return '61–90'; return '90+'; }

export function createPaymentMethods(database: DatabaseSync) {
  return {
    listPayments(session: AppSession, query: PaymentQuery = {}): PaymentList {
      requireTenantMember(session);
      const conditions = ['payments.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.customerId) { conditions.push('invoices.customer_id = ?'); values.push(query.customerId); }
      if (query.search?.trim()) { conditions.push('(lower(invoices.invoice_number) LIKE ? OR lower(customers.company_name) LIKE ? OR lower(payments.reference) LIKE ? OR lower(payments.notes) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term, term, term); }
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) { conditions.push('substr(payments.payment_date, 1, 7) = ?'); values.push(query.month); }
      const where = conditions.join(' AND '); const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const joined = ` FROM payments JOIN invoices ON invoices.id = payments.invoice_id JOIN customers ON customers.id = invoices.customer_id WHERE ${where}`;
      const total = Number((database.prepare(`SELECT COUNT(*) AS count${joined}`).get(...values) as { count: number }).count);
      const applied = Number((database.prepare(`SELECT COALESCE(SUM(payments.amount_minor + payments.tds_minor + payments.write_off_minor), 0) AS amount${joined}`).get(...values) as { amount: number }).amount);
      const rows = database.prepare(`SELECT payments.*, invoices.invoice_number, invoices.customer_id, customers.company_name AS customer_name${joined} ORDER BY payments.payment_date DESC, payments.recorded_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(paymentFromRow), total, totalAppliedMinor: applied };
    },
    recordPayment(session: AppSession, input: PaymentInput): TenantPayment {
      requireTenantMember(session);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) throw new Error('Enter a valid payment date.');
      for (const value of [input.amountMinor, input.tdsMinor, input.writeOffMinor]) if (!Number.isInteger(value) || value < 0) throw new Error('Payment, TDS, and write-off values must be non-negative whole minor amounts.');
      const appliedMinor = input.amountMinor + input.tdsMinor + input.writeOffMinor;
      if (appliedMinor <= 0) throw new Error('Enter a payment, TDS, or write-off amount.');
      const invoiceRow = database.prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?').get(input.invoiceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!invoiceRow) throw new Error('This invoice does not belong to your tenant.');
      if (invoiceRow.status === 'void' || invoiceRow.status === 'paid') throw new Error('Payments can only be allocated to an outstanding invoice.');
      const outstanding = Number(invoiceRow.total_minor) - Number(invoiceRow.paid_minor);
      if (appliedMinor > outstanding) throw new Error('Allocation cannot exceed the outstanding invoice balance.');
      const id = crypto.randomUUID(); const timestamp = now(); const paidMinor = Number(invoiceRow.paid_minor) + appliedMinor; const status: InvoiceStatus = paidMinor === Number(invoiceRow.total_minor) ? 'paid' : 'partial';
      database.exec('BEGIN');
      try {
        database.prepare('INSERT INTO payments (id, tenant_id, invoice_id, payment_date, amount_minor, tds_minor, write_off_minor, method, reference, notes, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, session.tenantId, input.invoiceId, input.paymentDate, input.amountMinor, input.tdsMinor, input.writeOffMinor, input.method, input.reference?.trim() ?? '', input.notes?.trim() ?? '', timestamp);
        database.prepare('UPDATE invoices SET paid_minor = ?, status = ? WHERE id = ? AND tenant_id = ?').run(paidMinor, status, input.invoiceId, session.tenantId);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Payment allocation recorded for ${String(invoiceRow.invoice_number)}.`, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return this.getPayment(session, id)!;
    },
    getPayment(session: AppSession, paymentId: string): TenantPayment | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT payments.*, invoices.invoice_number, invoices.customer_id, customers.company_name AS customer_name FROM payments JOIN invoices ON invoices.id = payments.invoice_id JOIN customers ON customers.id = invoices.customer_id WHERE payments.id = ? AND payments.tenant_id = ?').get(paymentId, session.tenantId) as Record<string, unknown> | undefined;
      return row ? paymentFromRow(row) : null;
    },
    updatePaymentDetails(session: AppSession, paymentId: string, update: Pick<TenantPayment, 'method' | 'reference' | 'notes'>): TenantPayment {
      requireTenantMember(session);
      const payment = this.getPayment(session, paymentId);
      if (!payment) throw new Error('Payment not found.');
      if (!['bank_transfer', 'cash', 'card', 'cheque', 'other'].includes(update.method)) throw new Error('Choose a valid payment method.');
      if (typeof update.reference !== 'string' || typeof update.notes !== 'string') throw new Error('Reference and notes must be text.');
      database.exec('BEGIN');
      try {
        database.prepare('UPDATE payments SET method = ?, reference = ?, notes = ? WHERE id = ? AND tenant_id = ?').run(update.method, update.reference.trim(), update.notes.trim(), paymentId, session.tenantId);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Payment details updated for ${payment.invoiceNumber}. Amount and allocation were unchanged.`, now());
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return this.getPayment(session, paymentId)!;
    },
    closeInvoice(session: AppSession, invoiceId: string, note = ''): TenantPayment {
      requireTenantMember(session);
      const invoice = database.prepare('SELECT invoice_number, total_minor, paid_minor, status FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!invoice) throw new Error('This invoice does not belong to your tenant.');
      const outstanding = Number(invoice.total_minor) - Number(invoice.paid_minor);
      if (outstanding <= 0 || invoice.status === 'void') throw new Error('Only an outstanding invoice can be closed.');
      const payment = this.recordPayment(session, { invoiceId, paymentDate: new Date().toISOString().slice(0, 10), amountMinor: 0, tdsMinor: 0, writeOffMinor: outstanding, method: 'other', reference: 'CLOSEOUT', notes: note.trim() || 'Closed from pending payments.' });
      database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `Invoice ${String(invoice.invoice_number)} was closed from Pending payments; outstanding balance was written off.`, now());
      return payment;
    },
    listPendingPayments(session: AppSession): PendingPayment[] {
      requireTenantMember(session);
      const rows = database.prepare('SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.id = invoices.customer_id WHERE invoices.tenant_id = ? AND invoices.status != \'void\' AND invoices.paid_minor < invoices.total_minor ORDER BY invoices.due_date ASC').all(session.tenantId) as Record<string, unknown>[];
      const reminderStatement = database.prepare('SELECT * FROM payment_reminders WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at DESC');
      return rows.map((row) => { const invoice = invoiceFromRow(row); const daysOverdue = daysLate(invoice.dueDate); return { ...invoice, outstandingMinor: invoice.totalMinor - invoice.paidMinor, daysOverdue, agingBucket: agingFor(daysOverdue), reminders: (reminderStatement.all(invoice.id, session.tenantId) as Record<string, unknown>[]).map(reminderFromRow) }; });
    },
    recordPaymentReminder(session: AppSession, invoiceId: string, input: { channel: PaymentReminder['channel']; note?: string }): PaymentReminder {
      requireTenantMember(session);
      if (input.channel !== 'email' && input.channel !== 'whatsapp') throw new Error('Choose email or WhatsApp for the reminder.');
      const invoice = database.prepare('SELECT id, invoice_number, paid_minor, total_minor FROM invoices WHERE id = ? AND tenant_id = ?').get(invoiceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!invoice) throw new Error('This invoice does not belong to your tenant.');
      if (Number(invoice.paid_minor) >= Number(invoice.total_minor)) throw new Error('Paid invoices do not need payment reminders.');
      const id = crypto.randomUUID(); const timestamp = now(); const note = input.note?.trim() ?? '';
      database.exec('BEGIN');
      try {
        database.prepare('INSERT INTO payment_reminders (id, tenant_id, invoice_id, channel, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, session.tenantId, invoiceId, input.channel, note, timestamp);
        database.prepare('INSERT INTO operational_logs (id, tenant_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), session.tenantId, 'feature-flow', `${input.channel === 'email' ? 'Email' : 'WhatsApp'} payment reminder prepared for ${String(invoice.invoice_number)}; no external message was sent.`, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return reminderFromRow(database.prepare('SELECT * FROM payment_reminders WHERE id = ?').get(id) as Record<string, unknown>);
    },
  };
}
