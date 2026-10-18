import { expect, it } from 'vitest';
import { describeStore, storeForTest, registerSeller } from './test-store';
import { tenantContextOf } from '../auth/session-context';

describeStore(['settings', 'customers', 'services', 'contracts', 'invoices'], 'invoices', () => {
  it('persists row-wise GST, billing details and corrected line items', async () => {
    const store = await storeForTest(); const session = await store.authenticate('nexio-admin');
    if (!session) throw new Error('Expected tenant session');
    await registerSeller(store, session);
    const customer = (await store.listCustomers(tenantContextOf(session))).items[0];
    const details = { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', venue: 'Bengaluru', billingAddress: 'New billing address', customerPan: 'ABCDE1234F', customerGstin: '29AAGCB7383J1Z4', gstApplicable: true, notes: 'Monthly booking' };
    const first = await store.createIssuedInvoice(tenantContextOf(session), { ...details, taxSplitOverrideReason: 'Supply to an SEZ unit', lines: [
      { description: 'Venue booking', quantity: 2, rateMinor: 12500, taxType: 'igst', gstRate: 18, hsnSac: '998311' },
      { description: 'Security deposit', quantity: 1, rateMinor: 5000, taxType: 'none', gstRate: 0 },
    ] });
    expect(first).toMatchObject({ taxableMinor: 30000, gstMinor: 4500, totalMinor: 34500, snapshot: { venue: 'Bengaluru', customerAddress: 'New billing address', notes: 'Monthly booking', lines: [{ amountMinor: 25000, gstMinor: 4500 }, { amountMinor: 5000, gstMinor: 0 }] } });
    expect((await store.getGstSalesReport(tenantContextOf(session), '2026-10')).items.find((row) => row.invoiceId === first.id)).toMatchObject({ igstMinor: 4500, cgstMinor: 0, sgstMinor: 0 });
    const corrected = await store.correctInvoice(tenantContextOf(session), first.id, { ...details, lines: [{ description: 'Revised booking', quantity: 1, rateMinor: 20000, taxType: 'cgst_sgst', gstRate: 12, hsnSac: '998311' }] }, 'Reduced booking');
    expect(corrected).toMatchObject({ taxableMinor: 20000, gstMinor: 2400, totalMinor: 22400, snapshot: { lines: [{ description: 'Revised booking', taxType: 'cgst_sgst' }] } });
    expect((await store.getGstSalesReport(tenantContextOf(session), '2026-10')).items.find((row) => row.invoiceId === corrected.id)).toMatchObject({ igstMinor: 0, cgstMinor: 1200, sgstMinor: 1200 });
    expect((await store.getInvoice(tenantContextOf(session), first.id))?.status).toBe('void');
    await expect(store.createIssuedInvoice(tenantContextOf(session), { ...details, lines: [{ description: 'Invalid', quantity: 1, rateMinor: 100, taxType: 'none', gstRate: 18 }] })).rejects.toThrow('valid GST');
  });

  it('voids an unpaid invoice with a reason and records operation errors for tenant admins', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected tenant session');
    const customer = (await store.listCustomers(tenantContextOf(nexio))).items[0];
    const invoice = await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 10000 });
    await expect(store.voidInvoice(tenantContextOf(nexio), invoice.id, '')).rejects.toThrow('reason');
    expect((await store.voidInvoice(tenantContextOf(nexio), invoice.id, 'Issued in error')).status).toBe('void');
    await expect(store.voidInvoice(tenantContextOf(nexio), invoice.id, 'Again')).rejects.toThrow('already void');
    await store.recordOperationalError(tenantContextOf(nexio), 'Test operation', new Error('Test failure'));
    expect(await store.listOperationalLogs(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'error', message: expect.stringContaining('Test failure') })]));
  });

  it('returns a tenant-scoped GST sales report with interstate and intrastate tax splits', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    await store.updateTenantSettings(tenantContextOf(nexio), { ...await store.getTenantSettings(tenantContextOf(nexio)), gstin: '29AAGCB7383J1Z4' });
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const interstate = await store.createCustomer(tenantContextOf(nexio), { companyName: 'Interstate Buyer', contactName: 'Ravi', email: 'ravi@example.com', phone: '9000000000', gstin: '27AAPFU0939F1ZV', billingAddress: 'Mumbai', invoiceDelivery: 'email' });
    await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: customer.id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 10_000, gstRate: 18 });
    await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: interstate.id, invoiceDate: '2026-11-03', dueDate: '2026-11-17', taxableMinor: 20_000, gstRate: 18 });

    const report = await store.getGstSalesReport(tenantContextOf(nexio), '2026-11');

    expect(report).toMatchObject({ month: '2026-11', companyName: 'Nexio Hyper', gstin: '29AAGCB7383J1Z4', totals: { taxableMinor: 30_000, gstMinor: 5_400, totalMinor: 35_400, igstMinor: 3_600, cgstMinor: 900, sgstMinor: 900, netGstMinor: 5_400 } });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerName: customer.companyName, cgstMinor: 900, sgstMinor: 900, igstMinor: 0 }),
      expect.objectContaining({ customerName: 'Interstate Buyer', igstMinor: 3_600, cgstMinor: 0, sgstMinor: 0 }),
    ]));
    expect((await store.getGstSalesReport(tenantContextOf(evo), '2026-11')).items).toEqual([]);
  });

  it('keeps issued invoice snapshots stable, supports filters, and isolates invoices by tenant', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    await registerSeller(store, nexio);
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const contract = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [(await store.listServices(tenantContextOf(nexio)))[0].id], name: 'Snapshot contract', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 250000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    const issued = await store.createIssuedInvoice(tenantContextOf(nexio), { contractId: contract.id, invoiceDate: '2026-10-01', dueDate: '2026-10-15', taxableMinor: 250000, gstRate: 18 });
    expect((await store.listInvoices(tenantContextOf(nexio), { month: '2026-10', search: customer.companyName })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id, customerName: customer.companyName, status: 'issued' })]));
    expect((await store.listInvoices(tenantContextOf(evo), {})).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id })]));
    await store.updateTenantSettings(tenantContextOf(nexio), { ...await store.getTenantSettings(tenantContextOf(nexio)), companyName: 'Changed company', invoicePrefix: 'NEW' });
    expect(await store.getInvoice(tenantContextOf(nexio), issued.id)).toMatchObject({ invoiceNumber: expect.stringContaining('NEX'), snapshot: expect.objectContaining({ companyName: 'Nexio Hyper', customerName: customer.companyName, gstRate: 18 }) });
    expect(await store.getInvoice(tenantContextOf(evo), issued.id)).toBeNull();
  });
});
