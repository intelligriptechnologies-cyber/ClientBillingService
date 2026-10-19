import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, registerSeller, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore(['settings', 'customers', 'services', 'contracts', 'additionalServices', 'invoices', 'bulkInvoices'], 'bulk invoice runs', () => {
  it('previews a period billing run with additional services, explains skips, and issues it only once', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');
    await registerSeller(store, nexio);
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const service = (await store.listServices(tenantContextOf(nexio)))[0];
    if (!customer || !service) throw new Error('Expected seeded customer and service');

    const eligible = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [service.id], name: 'October managed billing', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [service.id], name: 'January-only annual billing', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'annual', invoiceMonths: [1], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    await store.createAdditionalService(tenantContextOf(nexio), { customerId: customer.id, contractId: eligible.id, serviceDate: '2026-10-15', description: 'On-site workshop', priceMinor: 25000, notes: '' });

    const preview = await store.previewBulkInvoices(tenantContextOf(nexio), '2026-10');
    expect(preview.proposed).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, additionalLines: [expect.objectContaining({ description: 'On-site workshop', priceMinor: 25000 })] })]));
    expect(preview.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'Billing is not scheduled for October.' })]));

    const first = await store.generateBulkInvoices(tenantContextOf(nexio), '2026-10');
    expect(first).toMatchObject({ alreadyGenerated: false, generatedCount: 1 });
    expect((await store.listInvoices(tenantContextOf(nexio), { month: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, gstMinor: 22500 })]));
    expect((await store.listAdditionalServices(tenantContextOf(nexio), { billingPeriod: '2026-10' })).items).toEqual([expect.objectContaining({ description: 'On-site workshop', billedAt: expect.any(String) })]);
    expect(await store.listBulkInvoiceRuns(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ billingPeriod: '2026-10', generatedCount: 1 })]));

    expect(await store.generateBulkInvoices(tenantContextOf(nexio), '2026-10')).toMatchObject({ alreadyGenerated: true, generatedCount: 1 });
    expect((await store.listInvoices(tenantContextOf(nexio), { month: '2026-10' })).items.filter((invoice) => invoice.contractId === eligible.id)).toHaveLength(1);
  });
});

describeStore(['settings', 'customers', 'services', 'contracts', 'invoices', 'bulkInvoices'], 'bulk invoice HSN/SAC codes', () => {
  async function registeredNexio() {
    const store = await storeForTest();
    const session = await signIn(store, 'nexio-admin');
    if (!session) throw new Error('Expected seeded session');
    await registerSeller(store, session);
    const context = tenantContextOf(session);
    const customer = (await store.listCustomers(context)).items[0];
    const seeded = (await store.listServices(context))[0];
    const contract = (serviceIds: string[], name: string) => store.createContract(context, {
      customerId: customer.id, serviceIds, name, startDate: '2026-01-01', endDate: '2026-12-31', valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    const setCode = (serviceId: string, hsnSac: string) => store.updateService(context, serviceId, { hsnSac });
    return { store, context, seeded, contract, setCode };
  }
  const prices = { monthly: 1000, quarterly: 3000, halfYearly: 6000, annual: 12000 };

  it('refuses a run that would issue GST for a service with no code, names the contract and the service, and records nothing', async () => {
    const { store, context, seeded, contract, setCode } = await registeredNexio();
    await setCode(seeded.id, '');
    await contract([seeded.id], 'Uncoded contract');
    const before = (await store.listInvoices(context, { pageSize: 100 })).total;

    await expect(store.previewBulkInvoices(context, '2026-10')).rejects.toThrow(/Uncoded contract.*Managed billing service.*HSN\/SAC/s);
    await expect(store.generateBulkInvoices(context, '2026-10')).rejects.toThrow(/Uncoded contract.*Managed billing service.*HSN\/SAC/s);

    expect(await store.listBulkInvoiceRuns(context)).toEqual([]);
    expect((await store.listInvoices(context, { pageSize: 100 })).total).toBe(before);
  });

  it('refuses a contract whose services carry different codes instead of picking one', async () => {
    const { store, context, seeded, contract, setCode } = await registeredNexio();
    await setCode(seeded.id, '998311');
    const other = await store.createService(context, { name: 'Second service', hsnSac: '995411', prices });
    await contract([seeded.id, other.id], 'Mixed contract');

    await expect(store.generateBulkInvoices(context, '2026-10')).rejects.toThrow(/Mixed contract.*different HSN\/SAC codes \(995411, 998311\)/s);
    expect(await store.listBulkInvoiceRuns(context)).toEqual([]);
  });

  it('puts the code of the contract services on the invoice it issues', async () => {
    const { store, context, seeded, contract, setCode } = await registeredNexio();
    await setCode(seeded.id, '998311');
    const created = await contract([seeded.id], 'Coded contract');

    await store.generateBulkInvoices(context, '2026-10');

    const invoice = (await store.listInvoices(context, { month: '2026-10', pageSize: 100 })).items.find((item) => item.contractId === created.id)!;
    expect(invoice.snapshot).toMatchObject({ documentType: 'Tax Invoice', hsnRequired: true, hsnSac: '998311' });
  });

  it('needs no code from a seller without a GSTIN, whose invoices carry no GST', async () => {
    const { store, context, seeded, contract, setCode } = await registeredNexio();
    await setCode(seeded.id, '');
    await store.updateTenantSettings(context, { ...await store.getTenantSettings(context), gstin: '' });
    const created = await contract([seeded.id], 'Plain contract');

    await store.generateBulkInvoices(context, '2026-10');

    const invoice = (await store.listInvoices(context, { month: '2026-10', pageSize: 100 })).items.find((item) => item.contractId === created.id)!;
    expect(invoice).toMatchObject({ gstMinor: 0 });
    expect(invoice.snapshot).not.toHaveProperty('hsnRequired');
  });
});

describeStore(['settings', 'customers', 'contracts', 'additionalServices', 'invoices', 'bulkInvoices'], 'bulk invoice runs under concurrent requests', () => {
  it('creates one run and one invoice per contract when a run for one period is started twice at once', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listBulkInvoiceRuns(nexio), store.listBulkInvoiceRuns(nexio)]);
    const proposed = (await store.previewBulkInvoices(nexio, '2026-11')).proposed;
    expect(proposed.length).toBeGreaterThan(0);

    const results = await Promise.all([store.generateBulkInvoices(nexio, '2026-11'), store.generateBulkInvoices(nexio, '2026-11')]);

    expect(results.map((result) => result.alreadyGenerated).sort()).toEqual([false, true]);
    expect(results[0].run).toEqual(results[1].run);
    expect((await store.listBulkInvoiceRuns(nexio)).filter((run) => run.billingPeriod === '2026-11')).toHaveLength(1);
    expect((await store.listInvoices(nexio, { month: '2026-11', pageSize: 100 })).items.map((invoice) => invoice.contractId).sort()).toEqual(proposed.map((item) => item.contractId).sort());
  });

  it('bills an additional service at the price it ends with when its price changes during the run', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    await Promise.all([store.listBulkInvoiceRuns(nexio), store.listBulkInvoiceRuns(nexio)]);
    const contract = (await store.listContracts(nexio)).items[0];

    // Which request goes first varies from run to run, so five months make a stale price show up in nearly every run.
    for (const month of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
      const extra = await store.createAdditionalService(nexio, { customerId: contract.customerId, contractId: contract.id, serviceDate: `${month}-10`, description: `Extra ${month}`, priceMinor: 10000 });
      await Promise.allSettled([store.generateBulkInvoices(nexio, month), store.updateAdditionalService(nexio, extra.id, { priceMinor: 40000 })]);
      const service = (await store.listAdditionalServices(nexio, { billingPeriod: month })).items.find((item) => item.id === extra.id)!;
      const invoice = (await store.listInvoices(nexio, { month })).items.find((item) => item.contractId === contract.id)!;
      expect(service.billedAt).not.toBeNull();
      expect(invoice.taxableMinor).toBe(contract.valueMinor + service.priceMinor);
    }
  });
});
