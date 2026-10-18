import { expect, it } from 'vitest';
import { describeStore, storeForTest, registerSeller } from './test-store';

describeStore(['settings', 'customers', 'invoices', 'payments'], 'payments', () => {
  it('corrects an unpaid invoice by replacing it and edits payment details without changing allocations', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected tenant session');
    await registerSeller(store, nexio);
    const customer = (await store.listCustomers(nexio)).items[0];
    const original = await store.createIssuedInvoice(nexio, { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 10000, gstRate: 18 });
    const corrected = await store.correctInvoice(nexio, original.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Corrected price');
    expect(corrected.id).not.toBe(original.id);
    expect(corrected.taxableMinor).toBe(12000);
    expect((await store.getInvoice(nexio, original.id))?.status).toBe('void');
    const payment = await store.recordPayment(nexio, { invoiceId: corrected.id, paymentDate: '2026-10-08', amountMinor: 5000, tdsMinor: 0, writeOffMinor: 0, method: 'bank_transfer', reference: 'OLD', notes: '' });
    const edited = await store.updatePaymentDetails(nexio, payment.id, { method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect(edited).toMatchObject({ appliedMinor: 5000, method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect((await store.getInvoice(nexio, corrected.id))?.paidMinor).toBe(5000);
    await expect(store.correctInvoice(nexio, corrected.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Again')).rejects.toThrow('payments');
  });

  it('allocates manual payments with TDS and write-off without exceeding an invoice balance', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin'); const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = (await store.listInvoices(nexio, {})).items[0];
    const payment = await store.recordPayment(nexio, { invoiceId: invoice.id, paymentDate: '2026-10-07', amountMinor: 100000, tdsMinor: 10000, writeOffMinor: 8000, method: 'bank_transfer', reference: 'UTR-2042', notes: 'Reconciled with customer.' });
    expect(payment).toMatchObject({ invoiceId: invoice.id, appliedMinor: 118000, reference: 'UTR-2042' });
    expect(await store.getInvoice(nexio, invoice.id)).toMatchObject({ paidMinor: 118000, status: 'paid' });
    expect((await store.listPayments(nexio, { month: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: payment.id, customerId: invoice.customerId })]));
    await expect(store.recordPayment(nexio, { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).rejects.toThrow('outstanding');
    await expect(store.recordPayment(evo, { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).rejects.toThrow('tenant');
  });

  it('closes an outstanding tenant invoice with an auditable write-off allocation', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin'); const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = (await store.listPendingPayments(nexio))[0];
    if (!invoice) throw new Error('Expected an outstanding invoice');
    const payment = await store.closeInvoice(nexio, invoice.id, 'Approved closeout');
    expect(payment).toMatchObject({ invoiceId: invoice.id, amountMinor: 0, writeOffMinor: invoice.outstandingMinor, reference: 'CLOSEOUT' });
    expect((await store.listPendingPayments(nexio)).map((item) => item.id)).not.toContain(invoice.id);
    expect((await store.listOperationalLogs(nexio)).some((log) => log.message.includes(`Invoice ${invoice.invoiceNumber} was closed`))).toBe(true);
    await expect(store.closeInvoice(evo, invoice.id)).rejects.toThrow('tenant');
  });
});

describeStore(['invoices', 'payments', 'reminders'], 'payment reminders', () => {
  it('lists aging pending invoices and records demo-only reminder history', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');
    const invoice = (await store.listInvoices(nexio, {})).items[0];
    const pending = await store.listPendingPayments(nexio);
    expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({ id: invoice.id, outstandingMinor: invoice.totalMinor, agingBucket: expect.any(String) })]));
    const reminder = await store.recordPaymentReminder(nexio, invoice.id, { channel: 'whatsapp', note: 'Please confirm payment date.' });
    expect(reminder).toMatchObject({ invoiceId: invoice.id, channel: 'whatsapp' });
    expect((await store.listPendingPayments(nexio)).find((item) => item.id === invoice.id)?.reminders).toEqual(expect.arrayContaining([expect.objectContaining({ id: reminder.id, channel: 'whatsapp' })]));
  });
});
