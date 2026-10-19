import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, registerSeller, unregisterSeller, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';
describeStore('invoices', () => {
  it('persists row-wise GST, billing details and corrected line items', async () => {
    const store = await storeForTest(); const session = await signIn(store, 'nexio-admin');
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
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin');
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
    const nexio = await signIn(store, 'nexio-admin');
    const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    await store.updateTenantSettings(tenantContextOf(nexio), { ...await store.getTenantSettings(tenantContextOf(nexio)), gstin: '29AAGCB7383J1Z4' });
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const interstate = await store.createCustomer(tenantContextOf(nexio), { companyName: 'Interstate Buyer', contactName: 'Ravi', email: 'ravi@example.com', phone: '9000000000', gstin: '27AAPFU0939F1ZV', billingAddress: 'Mumbai', invoiceDelivery: 'email' });
    await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: customer.id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 10_000, gstRate: 18, hsnSac: '998311' });
    await store.createIssuedInvoice(tenantContextOf(nexio), { customerId: interstate.id, invoiceDate: '2026-11-03', dueDate: '2026-11-17', taxableMinor: 20_000, gstRate: 18, hsnSac: '998311' });

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
    const nexio = await signIn(store, 'nexio-admin');
    const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    await registerSeller(store, nexio);
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const contract = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [(await store.listServices(tenantContextOf(nexio)))[0].id], name: 'Snapshot contract', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 250000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    const issued = await store.createIssuedInvoice(tenantContextOf(nexio), { contractId: contract.id, invoiceDate: '2026-10-01', dueDate: '2026-10-15', taxableMinor: 250000, gstRate: 18, hsnSac: '998311' });
    expect((await store.listInvoices(tenantContextOf(nexio), { month: '2026-10', search: customer.companyName })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id, customerName: customer.companyName, status: 'issued' })]));
    expect((await store.listInvoices(tenantContextOf(evo), {})).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id })]));
    await store.updateTenantSettings(tenantContextOf(nexio), { ...await store.getTenantSettings(tenantContextOf(nexio)), companyName: 'Changed company', invoicePrefix: 'NEW' });
    expect(await store.getInvoice(tenantContextOf(nexio), issued.id)).toMatchObject({ invoiceNumber: expect.stringContaining('NEX'), snapshot: expect.objectContaining({ companyName: 'Nexio Hyper', customerName: customer.companyName, gstRate: 18 }) });
    expect(await store.getInvoice(tenantContextOf(evo), issued.id)).toBeNull();
  });
});

describeStore('invoices under concurrent requests', () => {
  async function withInvoice() {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listInvoices(nexio), store.listInvoices(nexio)]);
    const customerId = (await store.listCustomers(nexio)).items[0].id;
    const issue = (taxableMinor = 10000) => store.createIssuedInvoice(nexio, { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor });
    return { store, nexio, issue, invoice: await issue() };
  }
  const correction = { invoiceDate: '2026-11-02', dueDate: '2026-11-20', taxableMinor: 12000 };

  it('numbers 20 invoices issued at once 3 to 22, after the two the tenant already has, with no gap and no repeat', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const customerId = (await store.listCustomers(nexio)).items[0].id;
    expect((await store.listInvoices(nexio)).total).toBe(2);

    const issued = await Promise.all(Array.from({ length: 20 }, (_, index) => index).map((index) => store.createIssuedInvoice(nexio, { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 1000 * (index + 1) })));

    expect(issued.map((invoice) => invoice.invoiceNumber).sort()).toEqual(Array.from({ length: 20 }, (_, index) => `NEX-${String(index + 3).padStart(4, '0')}`));
    expect((await store.createIssuedInvoice(nexio, { customerId, invoiceDate: '2026-11-03', dueDate: '2026-11-17', taxableMinor: 500 })).invoiceNumber).toBe('NEX-0023');
  });

  it('replaces an invoice once when two corrections of it run at once', async () => {
    const { store, nexio, invoice } = await withInvoice();

    const results = await Promise.allSettled([store.correctInvoice(nexio, invoice.id, correction, 'First'), store.correctInvoice(nexio, invoice.id, correction, 'Second')]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await store.listInvoices(nexio, { pageSize: 100 })).items.filter((item) => item.status === 'issued' && item.taxableMinor === 12000)).toHaveLength(1);
    expect((await store.listOperationalLogs(nexio)).filter((log) => log.message.startsWith(`Invoice ${invoice.invoiceNumber} corrected`))).toHaveLength(1);
  });

  it('lets only one of a void and a correction of one invoice through when they run at once', async () => {
    const { store, nexio, invoice } = await withInvoice();

    const results = await Promise.allSettled([store.voidInvoice(nexio, invoice.id, 'Issued in error'), store.correctInvoice(nexio, invoice.id, correction, 'Price change')]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const replacements = (await store.listInvoices(nexio, { pageSize: 100 })).items.filter((item) => item.taxableMinor === 12000);
    expect(replacements).toHaveLength(results[1].status === 'fulfilled' ? 1 : 0);
  });
});

describeStore('invoice lists and input rules', () => {
  it('filters invoices and the GST register by month at the month edges, and refuses values a date or numeric column cannot hold', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    await store.updateTenantSettings(nexio, { ...await store.getTenantSettings(nexio), gstin: '29AAGCB7383J1Z4' });
    const customerId = (await store.listCustomers(nexio)).items[0].id;
    const issue = (invoiceDate: string, extra: { gstRate?: number; dueDate?: string } = {}) => store.createIssuedInvoice(nexio, { customerId, invoiceDate, dueDate: extra.dueDate ?? '2026-12-31', taxableMinor: 10000, gstRate: extra.gstRate, hsnSac: '998311' });
    const lastOfOctober = await issue('2026-10-31');
    const firstOfNovember = await issue('2026-11-01', { gstRate: 12.345 });
    const ids = async (month: string) => (await store.listInvoices(nexio, { month, pageSize: 100 })).items.map((invoice) => invoice.id);

    expect(await ids('2026-10')).toContain(lastOfOctober.id);
    expect(await ids('2026-10')).not.toContain(firstOfNovember.id);
    expect(await ids('2026-11')).toEqual([firstOfNovember.id]);
    expect(await ids('2026-13')).toEqual([]);
    expect((await store.listInvoices(nexio, { month: 'October', pageSize: 100 })).total).toBe(4);
    expect((await store.getGstSalesReport(nexio, '2026-11')).items.map((row) => row.invoiceId)).toEqual([firstOfNovember.id]);
    expect(firstOfNovember).toMatchObject({ gstRate: 12.345, gstMinor: 1235 });
    expect((await store.getInvoice(nexio, firstOfNovember.id))?.gstRate).toBe(12.345);

    await expect(store.getGstSalesReport(nexio, '2026-13')).rejects.toThrow('Choose a valid report month.');
    await expect(issue('2026-02-31')).rejects.toThrow('Enter valid invoice and due dates.');
    await expect(issue('2026-11-02', { dueDate: '2026-11-31' })).rejects.toThrow('Enter valid invoice and due dates.');
    await expect(issue('2026-11-02', { gstRate: 18.1234 })).rejects.toThrow('GST rate must be between 0 and 100, with at most three decimals.');
    await expect(store.createIssuedInvoice(nexio, { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 2 ** 53 })).rejects.toThrow('Taxable amount must be a non-negative whole minor amount.');
    await expect(store.previewBulkInvoices(nexio, '2026-13')).rejects.toThrow('Billing period must use YYYY-MM.');
    await expect(store.generateBulkInvoices(nexio, '2026-13')).rejects.toThrow('Billing period must use YYYY-MM.');
    expect((await store.listBulkInvoiceRuns(nexio))).toEqual([]);
  });
});

describeStore('invoice corrections', () => {
  it('leaves the original issued and spends no number when the replacement is refused', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    await unregisterSeller(store, nexio);
    const customerId = (await store.listCustomers(nexio)).items[0].id;
    const original = await store.createIssuedInvoice(nexio, { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 10000 });

    await expect(store.correctInvoice(nexio, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 12000, gstRate: 18 }, 'Add tax')).rejects.toThrow('Add your GSTIN');

    expect(await store.getInvoice(nexio, original.id)).toMatchObject({ status: 'issued', invoiceNumber: 'NEX-0003' });
    expect((await store.correctInvoice(nexio, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 12000 }, 'Price change')).invoiceNumber).toBe('NEX-0004');
  });
});

describeStore('HSN/SAC on GST invoices', () => {
  async function registeredNexio() {
    const store = await storeForTest();
    const session = await signIn(store, 'nexio-admin');
    if (!session) throw new Error('Expected tenant session');
    await registerSeller(store, session);
    const context = tenantContextOf(session);
    const customerId = (await store.listCustomers(context)).items[0].id;
    const details = { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16' };
    const gstLine = (extra: { hsnSac?: string } = {}) => ({ description: 'Hall hire', quantity: 1, rateMinor: 10000, taxType: 'cgst_sgst' as const, gstRate: 18, ...extra });
    return { store, context, details, gstLine };
  }

  it('refuses to issue a GST line with a missing or malformed code and issues it with a 4, 6 or 8 digit one', async () => {
    const { store, context, details, gstLine } = await registeredNexio();

    await expect(store.createIssuedInvoice(context, { ...details, lines: [gstLine()] })).rejects.toThrow('Line 1 needs an HSN/SAC code because a Tax Invoice taxes it.');
    await expect(store.createIssuedInvoice(context, { ...details, lines: [gstLine({ hsnSac: '   ' })] })).rejects.toThrow('Line 1 needs an HSN/SAC code');
    for (const hsnSac of ['12', '12345', '1234567', 'AB1234']) {
      await expect(store.createIssuedInvoice(context, { ...details, lines: [gstLine({ hsnSac })] }), hsnSac).rejects.toThrow('Enter a valid HSN/SAC code for line 1');
    }
    expect((await store.listInvoices(context, { month: '2026-11' })).total).toBe(0);

    for (const hsnSac of ['8517', '998311', '84713010']) {
      expect(await store.createIssuedInvoice(context, { ...details, lines: [gstLine({ hsnSac })] }), hsnSac).toMatchObject({ snapshot: { documentType: 'Tax Invoice', hsnRequired: true, lines: [{ hsnSac }] } });
    }
  });

  it('needs no code on an invoice whose lines carry no GST', async () => {
    const { store, context, details } = await registeredNexio();

    const invoice = await store.createIssuedInvoice(context, { ...details, lines: [{ description: 'Deposit', quantity: 1, rateMinor: 5000, taxType: 'none', gstRate: 0 }] });

    expect(invoice.snapshot).toMatchObject({ documentType: 'Bill of Supply' });
    expect(invoice.snapshot).not.toHaveProperty('hsnRequired');
  });

  it('refuses an amount-only GST invoice without a code and keeps the code it was issued with', async () => {
    const { store, context, details } = await registeredNexio();
    const amountOnly = { ...details, taxableMinor: 10000, gstRate: 18 };

    await expect(store.createIssuedInvoice(context, amountOnly)).rejects.toThrow('Line 1 needs an HSN/SAC code because a Tax Invoice taxes it.');
    await expect(store.createIssuedInvoice(context, { ...amountOnly, hsnSac: '12' })).rejects.toThrow('Enter a valid HSN/SAC code');

    const invoice = await store.createIssuedInvoice(context, { ...amountOnly, hsnSac: ' 998311 ' });

    expect(invoice.snapshot).toMatchObject({ documentType: 'Tax Invoice', hsnRequired: true, hsnSac: '998311' });
    expect((await store.createIssuedInvoice(context, { ...details, taxableMinor: 10000 })).snapshot).not.toHaveProperty('hsnSac');
  });

  it('refuses a correction whose GST line has no code and leaves the original as it was', async () => {
    const { store, context, details, gstLine } = await registeredNexio();
    const original = await store.createIssuedInvoice(context, { ...details, lines: [gstLine({ hsnSac: '998311' })] });

    await expect(store.correctInvoice(context, original.id, { ...details, lines: [gstLine()] }, 'Change rate')).rejects.toThrow('Line 1 needs an HSN/SAC code');
    await expect(store.correctInvoice(context, original.id, { ...details, lines: [gstLine({ hsnSac: '99' })] }, 'Change rate')).rejects.toThrow('Enter a valid HSN/SAC code');

    expect(await store.getInvoice(context, original.id)).toMatchObject({ status: 'issued' });
    expect((await store.correctInvoice(context, original.id, { ...details, lines: [gstLine({ hsnSac: '8517' })] }, 'Change code')).snapshot).toMatchObject({ hsnRequired: true });
  });

  it('keeps the code of an amount-only invoice when it is corrected without naming one', async () => {
    const { store, context, details } = await registeredNexio();
    const original = await store.createIssuedInvoice(context, { ...details, taxableMinor: 10000, gstRate: 18, hsnSac: '998311' });

    const corrected = await store.correctInvoice(context, original.id, { ...details, taxableMinor: 12000, gstRate: 18 }, 'Price change');

    expect(corrected.snapshot).toMatchObject({ hsnSac: '998311', hsnRequired: true });
  });
});
