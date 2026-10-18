import { expect, it } from 'vitest';
import { describeStore, storeForTest } from './test-store';

describeStore(['customers', 'services', 'contracts', 'additionalServices'], 'additional services', () => {
  it('records a dated additional service only against its customer contract and exposes it for that billing period', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = (await store.listCustomers(nexio, {})).items[0];
    const service = (await store.listServices(nexio))[0];
    if (!customer || !service) throw new Error('Expected seeded billing data');
    const contract = await store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'Managed reporting', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 120000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });

    const additional = await store.createAdditionalService(nexio, { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'On-site reporting workshop', priceMinor: 250000, notes: 'Approved by finance.' });

    expect((await store.listAdditionalServices(nexio, { billingPeriod: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id, contractId: contract.id, priceMinor: 250000 })]));
    expect((await store.listAdditionalServices(nexio, { billingPeriod: '2026-11' })).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id })]));
    expect((await store.listAdditionalServices(evo, {})).items).toEqual([]);
    await expect(store.createAdditionalService(evo, { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'Cross tenant', priceMinor: 100, notes: '' })).rejects.toThrow('tenant');
  });
});
