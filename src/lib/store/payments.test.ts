import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, registerSeller, signIn } from './test-store';
import type { PaymentInput, PaymentQuery, TenantInvoice } from './types';
import { tenantContextOf } from '../auth/principal';

describeStore(['settings', 'customers', 'invoices', 'payments'], 'payments', () => {
  it('corrects an unpaid invoice by replacing it and edits payment details without changing allocations', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin');
    if (!nexio) throw new Error('Expected tenant session');
    await registerSeller(store, nexio);
    const customer = (await store.listCustomers(tenantContextOf(nexio))).items[0];
    const original = await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 10000, gstRate: 18, hsnSac: '998311' });
    const corrected = await store.correctInvoice(tenantContextOf(nexio), original.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Corrected price');
    expect(corrected.id).not.toBe(original.id);
    expect(corrected.taxableMinor).toBe(12000);
    expect((await store.getInvoice(tenantContextOf(nexio), original.id))?.status).toBe('void');
    const payment = await store.recordPayment(tenantContextOf(nexio), { invoiceId: corrected.id, paymentDate: '2026-10-08', amountMinor: 5000, tdsMinor: 0, writeOffMinor: 0, method: 'bank_transfer', reference: 'OLD', notes: '' });
    const edited = await store.updatePaymentDetails(tenantContextOf(nexio), payment.id, { method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect(edited).toMatchObject({ appliedMinor: 5000, method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect((await store.getInvoice(tenantContextOf(nexio), corrected.id))?.paidMinor).toBe(5000);
    await expect(store.correctInvoice(tenantContextOf(nexio), corrected.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Again')).rejects.toThrow('payments');
  });

  it('allocates manual payments with TDS and write-off without exceeding an invoice balance', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin'); const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = (await store.listInvoices(tenantContextOf(nexio), {})).items[0];
    const payment = await store.recordPayment(tenantContextOf(nexio), { invoiceId: invoice.id, paymentDate: '2026-10-07', amountMinor: 100000, tdsMinor: 10000, writeOffMinor: 8000, method: 'bank_transfer', reference: 'UTR-2042', notes: 'Reconciled with customer.' });
    expect(payment).toMatchObject({ invoiceId: invoice.id, appliedMinor: 118000, reference: 'UTR-2042' });
    expect(await store.getInvoice(tenantContextOf(nexio), invoice.id)).toMatchObject({ paidMinor: 118000, status: 'paid' });
    expect((await store.listPayments(tenantContextOf(nexio), { month: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: payment.id, customerId: invoice.customerId })]));
    await expect(store.recordPayment(tenantContextOf(nexio), { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).rejects.toThrow('outstanding');
    await expect(store.recordPayment(tenantContextOf(evo), { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).rejects.toThrow('tenant');
  });

  it('closes an outstanding tenant invoice with an auditable write-off allocation', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin'); const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = (await store.listPendingPayments(tenantContextOf(nexio)))[0];
    if (!invoice) throw new Error('Expected an outstanding invoice');
    const payment = await store.closeInvoice(tenantContextOf(nexio), invoice.id, 'Approved closeout');
    expect(payment).toMatchObject({ invoiceId: invoice.id, amountMinor: 0, writeOffMinor: invoice.outstandingMinor, reference: 'CLOSEOUT' });
    expect((await store.listPendingPayments(tenantContextOf(nexio))).map((item) => item.id)).not.toContain(invoice.id);
    expect((await store.listOperationalLogs(tenantContextOf(nexio))).some((log) => log.message.includes(`Invoice ${invoice.invoiceNumber} was closed`))).toBe(true);
    await expect(store.closeInvoice(tenantContextOf(evo), invoice.id)).rejects.toThrow('tenant');
  });
});

describeStore(['invoices', 'payments'], 'payment register and input rules', () => {
  it('filters payments by month at the month edges and by search, totals what they apply, and refuses values a date column or the method list cannot hold', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const pay = (paymentDate: string, extra: Partial<PaymentInput> = {}) => store.recordPayment(nexio, { invoiceId: 'nexio-invoice-001', paymentDate, amountMinor: 1000, tdsMinor: 100, writeOffMinor: 0, method: 'cash', reference: 'Zq-ref', ...extra });
    const lastOfOctober = await pay('2026-10-31');
    const firstOfNovember = await pay('2026-11-01', { amountMinor: 2000, writeOffMinor: 50 });
    const list = (query: PaymentQuery) => store.listPayments(nexio, { pageSize: 100, ...query });

    expect((await list({ month: '2026-10' })).items.map((item) => item.id)).toEqual([lastOfOctober.id]);
    expect(await list({ month: '2026-11' })).toMatchObject({ total: 1, totalAppliedMinor: 2150, items: [{ id: firstOfNovember.id, appliedMinor: 2150 }] });
    expect((await list({ month: '2026-13' })).total).toBe(0);
    expect((await list({ search: 'zq-REF' })).items.map((item) => item.id)).toEqual([firstOfNovember.id, lastOfOctober.id]);
    expect(await list({})).toMatchObject({ total: 3, totalAppliedMinor: 118000 + 1100 + 2150 });

    await expect(pay('2026-02-31')).rejects.toThrow('Enter a valid payment date.');
    await expect(pay('2026-11-02', { method: 'barter' as never })).rejects.toThrow('Choose a valid payment method.');
    await expect(pay('2026-11-02', { amountMinor: 2 ** 53 })).rejects.toThrow('Payment, TDS, and write-off values must be non-negative whole minor amounts.');
    await expect(store.updatePaymentDetails(nexio, lastOfOctober.id, { method: 'barter' as never, reference: '', notes: '' })).rejects.toThrow('Choose a valid payment method.');
    expect(await store.getInvoice(nexio, 'nexio-invoice-001')).toMatchObject({ paidMinor: 3250, status: 'partial' });
  });
});

describeStore(['invoices', 'payments'], 'payments under concurrent requests', () => {
  const INVOICE = 'nexio-invoice-001';
  async function racing() {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listPayments(nexio), store.listPayments(nexio)]);
    const invoice = (await store.getInvoice(nexio, INVOICE))!;
    expect(invoice).toMatchObject({ totalMinor: 118000, paidMinor: 0, status: 'issued' });
    const pay = (amountMinor: number) => store.recordPayment(nexio, { invoiceId: INVOICE, paymentDate: '2026-10-20', amountMinor, tdsMinor: 0, writeOffMinor: 0, method: 'bank_transfer' });
    const settled = async () => {
      const applied = (await store.listPayments(nexio, { pageSize: 100 })).items.filter((item) => item.invoiceId === INVOICE).reduce((sum, item) => sum + item.appliedMinor, 0);
      return { applied, invoice: (await store.getInvoice(nexio, INVOICE))! };
    };
    return { store, nexio, pay, settled };
  }

  it('never overpays an invoice when two payments on it run at once', async () => {
    const { pay, settled } = await racing();

    const results = await Promise.allSettled([pay(70000), pay(70000)]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const { applied, invoice } = await settled();
    expect(applied).toBe(70000);
    expect(invoice).toMatchObject({ paidMinor: 70000, status: 'partial' });
  });

  it('lets only one of a payment and a void of one invoice through when they run at once', async () => {
    const { store, nexio, pay, settled } = await racing();

    const results = await Promise.allSettled([pay(50000), store.voidInvoice(nexio, INVOICE, 'Issued in error')]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const { applied, invoice } = await settled();
    expect(invoice).toMatchObject(results[0].status === 'fulfilled' ? { status: 'partial', paidMinor: 50000 } : { status: 'void', paidMinor: 0 });
    expect(applied).toBe(invoice.paidMinor);
  });

  it('never writes off more than is outstanding when a close and a payment run at once', async () => {
    const { store, nexio, pay, settled } = await racing();

    await Promise.allSettled([store.closeInvoice(nexio, INVOICE, 'Approved closeout'), pay(50000)]);

    const { applied, invoice } = await settled();
    expect(invoice).toMatchObject({ status: 'paid', paidMinor: 118000 });
    expect(applied).toBe(118000);
  });
});

describeStore(['invoices', 'payments', 'reminders'], 'payment reminders', () => {
  it('lists aging pending invoices and records demo-only reminder history', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');
    const invoice = (await store.listInvoices(tenantContextOf(nexio), {})).items[0];
    const pending = await store.listPendingPayments(tenantContextOf(nexio));
    expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({ id: invoice.id, outstandingMinor: invoice.totalMinor, agingBucket: expect.any(String) })]));
    const reminder = await store.recordPaymentReminder(tenantContextOf(nexio), invoice.id, { channel: 'whatsapp', note: 'Please confirm payment date.' });
    expect(reminder).toMatchObject({ invoiceId: invoice.id, channel: 'whatsapp' });
    expect((await store.listPendingPayments(tenantContextOf(nexio))).find((item) => item.id === invoice.id)?.reminders).toEqual(expect.arrayContaining([expect.objectContaining({ id: reminder.id, channel: 'whatsapp' })]));
  });

  it('puts each pending invoice in the aging bucket its days overdue fall in, newest reminder first', async () => {
    const store = await storeForTest(); const nexio = await memberContext(store, 'nexio-admin');
    const customerId = (await store.listCustomers(nexio)).items[0].id;
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const buckets: Array<[number, string]> = [[0, 'Current'], [10, '1–30'], [45, '31–60'], [75, '61–90'], [120, '90+']];
    const issued: TenantInvoice[] = [];
    for (const [days] of buckets) issued.push(await store.createIssuedInvoice(nexio, { customerId, invoiceDate: daysAgo(days + 1), dueDate: daysAgo(days), taxableMinor: 1000 + days }));
    const pending = await store.listPendingPayments(nexio);
    expect(issued.map((invoice) => pending.find((item) => item.id === invoice.id)?.agingBucket)).toEqual(buckets.map(([, bucket]) => bucket));
    expect(pending.find((item) => item.id === issued[2].id)).toMatchObject({ daysOverdue: 45, outstandingMinor: 1045 });

    const first = await store.recordPaymentReminder(nexio, issued[0].id, { channel: 'email', note: 'First' });
    const second = await store.recordPaymentReminder(nexio, issued[0].id, { channel: 'whatsapp', note: 'Second' });
    expect((await store.listPendingPayments(nexio)).find((item) => item.id === issued[0].id)?.reminders.map((item) => item.id)).toEqual([second.id, first.id]);
    await expect(store.recordPaymentReminder(nexio, issued[0].id, { channel: 'sms' as never })).rejects.toThrow('Choose email or WhatsApp for the reminder.');
  });
});
