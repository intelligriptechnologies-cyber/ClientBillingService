import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseInvoiceRow, parsePaymentRow, parseReminderRow } from '../rows';
import { allocation, closeout, monthDays, paymentApplied, paymentDetails, pendingPayment, reminderMessage, reminderNote } from '../rules';
import { now } from '../shared';
import type { PaymentInput, PaymentList, PaymentQuery, PaymentReminder, PendingPayment, TenantInvoice, TenantPayment, TenantStore } from '../types';
import { findInvoice, logFlow } from './invoices';

type Row = Record<string, unknown>;

const paymentJoin = ` FROM payments
  JOIN invoices ON invoices.tenant_id = payments.tenant_id AND invoices.id = payments.invoice_id
  JOIN customers ON customers.tenant_id = invoices.tenant_id AND customers.id = invoices.customer_id`;
const paymentColumns = 'payments.*, invoices.invoice_number, invoices.customer_id, customers.company_name AS customer_name';

async function findPayment(tx: Tx, tenantId: string, paymentId: string): Promise<TenantPayment | null> {
  const { rows } = await tx.query<Row>(`SELECT ${paymentColumns}${paymentJoin} WHERE payments.id = $1 AND payments.tenant_id = $2`, [paymentId, tenantId]);
  return rows[0] ? parsePaymentRow(rows[0]) : null;
}

/** Records the payment against `invoice`, which the caller has locked FOR UPDATE, so its balance cannot change before the write. */
async function allocate(tx: Tx, tenantId: string, invoice: TenantInvoice | null, input: PaymentInput, appliedMinor: number): Promise<string> {
  const { paidMinor, status } = allocation(invoice, appliedMinor);
  const id = crypto.randomUUID(); const timestamp = now();
  await tx.query(
    'INSERT INTO payments (id, tenant_id, invoice_id, payment_date, amount_minor, tds_minor, write_off_minor, method, reference, notes, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [id, tenantId, input.invoiceId, input.paymentDate, input.amountMinor, input.tdsMinor, input.writeOffMinor, input.method, input.reference?.trim() ?? '', input.notes?.trim() ?? '', timestamp],
  );
  await tx.query('UPDATE invoices SET paid_minor = $1, status = $2 WHERE id = $3 AND tenant_id = $4', [paidMinor, status, input.invoiceId, tenantId]);
  await logFlow(tx, tenantId, `Payment allocation recorded for ${invoice!.invoiceNumber}.`, timestamp);
  return id;
}

export function createPgPaymentMethods(db: Database) {
  return {
    /** The month filter is a half-open range of days on payment_date, where SQLite matches a text prefix; a month that is not YYYY-MM is ignored, as there. */
    async listPayments(context: TenantContext, query: PaymentQuery = {}): Promise<PaymentList> {
      const conditions = ['payments.tenant_id = $1'];
      const values: unknown[] = [context.tenantId];
      const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
      if (query.customerId) where((p) => `invoices.customer_id = ${p}`, query.customerId);
      const search = query.search?.trim().toLowerCase();
      if (search) where((p) => `(lower(invoices.invoice_number) LIKE ${p} ESCAPE '' OR lower(customers.company_name) LIKE ${p} ESCAPE '' OR lower(payments.reference) LIKE ${p} ESCAPE '' OR lower(payments.notes) LIKE ${p} ESCAPE '')`, `%${search}%`);
      if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
        const days = monthDays(query.month);
        if (!days) conditions.push('false');
        else { where((p) => `payments.payment_date >= ${p}`, days.start); where((p) => `payments.payment_date < ${p}`, days.end); }
      }
      const joined = `${paymentJoin} WHERE ${conditions.join(' AND ')}`;
      const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100); const page = Math.max(query.page ?? 1, 1);
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows: [totals] } = await tx.query<Row>(`SELECT count(*) AS count, COALESCE(SUM(payments.amount_minor + payments.tds_minor + payments.write_off_minor), 0) AS applied${joined}`, values);
        const { rows } = await tx.query<Row>(`SELECT ${paymentColumns}${joined} ORDER BY payments.payment_date DESC, payments.recorded_at DESC, payments.id COLLATE "C" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return { items: rows.map(parsePaymentRow), total: Number(totals.count), totalAppliedMinor: Number(totals.applied) };
      });
    },
    /** Locks the invoice before reading its balance, so two payments, or a payment and a void, take turns. */
    async recordPayment(context: TenantContext, input: PaymentInput): Promise<TenantPayment> {
      const appliedMinor = paymentApplied(input);
      return db.withTenant(context.tenantId, async (tx) => {
        const id = await allocate(tx, context.tenantId, await findInvoice(tx, context.tenantId, input.invoiceId, true), input, appliedMinor);
        return (await findPayment(tx, context.tenantId, id))!;
      });
    },
    async getPayment(context: TenantContext, paymentId: string): Promise<TenantPayment | null> {
      return db.withTenant(context.tenantId, (tx) => findPayment(tx, context.tenantId, paymentId));
    },
    /** A full replace of the method, reference and notes in one UPDATE; the amounts and allocation never change here. */
    async updatePaymentDetails(context: TenantContext, paymentId: string, update: Pick<TenantPayment, 'method' | 'reference' | 'notes'>): Promise<TenantPayment> {
      return db.withTenant(context.tenantId, async (tx) => {
        const payment = await findPayment(tx, context.tenantId, paymentId);
        if (!payment) throw new Error('Payment not found.');
        const details = paymentDetails(update);
        await tx.query('UPDATE payments SET method = $1, reference = $2, notes = $3 WHERE id = $4 AND tenant_id = $5', [details.method, details.reference, details.notes, paymentId, context.tenantId]);
        await logFlow(tx, context.tenantId, `Payment details updated for ${payment.invoiceNumber}. Amount and allocation were unchanged.`);
        return (await findPayment(tx, context.tenantId, paymentId))!;
      });
    },
    /** Locks the invoice before working out what is outstanding, so the write-off never covers a payment that landed meanwhile. */
    async closeInvoice(context: TenantContext, invoiceId: string, note = ''): Promise<TenantPayment> {
      return db.withTenant(context.tenantId, async (tx) => {
        const invoice = await findInvoice(tx, context.tenantId, invoiceId, true);
        const input = { invoiceId, ...closeout(invoice, note) };
        const id = await allocate(tx, context.tenantId, invoice, input, paymentApplied(input));
        await logFlow(tx, context.tenantId, `Invoice ${invoice!.invoiceNumber} was closed from Pending payments; outstanding balance was written off.`);
        return (await findPayment(tx, context.tenantId, id))!;
      });
    },
    async listPendingPayments(context: TenantContext): Promise<PendingPayment[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>(
          `SELECT invoices.*, customers.company_name AS customer_name FROM invoices JOIN customers ON customers.tenant_id = invoices.tenant_id AND customers.id = invoices.customer_id
           WHERE invoices.tenant_id = $1 AND invoices.status <> 'void' AND invoices.paid_minor < invoices.total_minor ORDER BY invoices.due_date, invoices.id COLLATE "C"`,
          [context.tenantId],
        );
        const reminders = rows.length ? (await tx.query<Row>('SELECT * FROM payment_reminders WHERE tenant_id = $1 AND invoice_id = ANY($2) ORDER BY created_at DESC, id COLLATE "C" DESC', [context.tenantId, rows.map((row) => row.id)])).rows : [];
        return rows.map((row) => pendingPayment(parseInvoiceRow(row), reminders.filter((reminder) => reminder.invoice_id === row.id).map(parseReminderRow)));
      });
    },
    /** clock_timestamp() rather than now(): reminders made in quick succession still list newest first. */
    async recordPaymentReminder(context: TenantContext, invoiceId: string, input: { channel: PaymentReminder['channel']; note?: string }): Promise<PaymentReminder> {
      return db.withTenant(context.tenantId, async (tx) => {
        const invoice = await findInvoice(tx, context.tenantId, invoiceId);
        const note = reminderNote(invoice, input);
        const { rows } = await tx.query<Row>('INSERT INTO payment_reminders (id, tenant_id, invoice_id, channel, note, created_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING *', [crypto.randomUUID(), context.tenantId, invoiceId, input.channel, note]);
        await logFlow(tx, context.tenantId, reminderMessage(input.channel, invoice!.invoiceNumber));
        return parseReminderRow(rows[0]);
      });
    },
  } satisfies Partial<TenantStore>;
}
