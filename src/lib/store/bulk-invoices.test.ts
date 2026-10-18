import { expect, it } from 'vitest';
import { describeStore, storeForTest, registerSeller } from './test-store';
import { tenantContextOf } from '../auth/session-context';

describeStore(['settings', 'customers', 'services', 'contracts', 'additionalServices', 'invoices', 'bulkInvoices'], 'bulk invoice runs', () => {
  it('previews a period billing run with additional services, explains skips, and issues it only once', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
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

    const preview = await store.previewBulkInvoices(nexio, '2026-10');
    expect(preview.proposed).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, additionalLines: [expect.objectContaining({ description: 'On-site workshop', priceMinor: 25000 })] })]));
    expect(preview.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'Billing is not scheduled for October.' })]));

    const first = await store.generateBulkInvoices(nexio, '2026-10');
    expect(first).toMatchObject({ alreadyGenerated: false, generatedCount: 1 });
    expect((await store.listInvoices(nexio, { month: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, gstMinor: 22500 })]));
    expect((await store.listAdditionalServices(tenantContextOf(nexio), { billingPeriod: '2026-10' })).items).toEqual([expect.objectContaining({ description: 'On-site workshop', billedAt: expect.any(String) })]);
    expect(await store.listBulkInvoiceRuns(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ billingPeriod: '2026-10', generatedCount: 1 })]));

    expect(await store.generateBulkInvoices(nexio, '2026-10')).toMatchObject({ alreadyGenerated: true, generatedCount: 1 });
    expect((await store.listInvoices(nexio, { month: '2026-10' })).items.filter((invoice) => invoice.contractId === eligible.id)).toHaveLength(1);
  });
});
