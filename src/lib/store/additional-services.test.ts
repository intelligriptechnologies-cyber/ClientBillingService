import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore('additional services', () => {
  it('records a dated additional service only against its customer contract and exposes it for that billing period', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin');
    const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const service = (await store.listServices(tenantContextOf(nexio)))[0];
    if (!customer || !service) throw new Error('Expected seeded billing data');
    const contract = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [service.id], name: 'Managed reporting', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 120000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });

    const additional = await store.createAdditionalService(tenantContextOf(nexio), { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'On-site reporting workshop', priceMinor: 250000, notes: 'Approved by finance.' });

    expect((await store.listAdditionalServices(tenantContextOf(nexio), { billingPeriod: '2026-10' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id, contractId: contract.id, priceMinor: 250000 })]));
    expect((await store.listAdditionalServices(tenantContextOf(nexio), { billingPeriod: '2026-11' })).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id })]));
    expect((await store.listAdditionalServices(tenantContextOf(evo), {})).items).toEqual([]);
    await expect(store.createAdditionalService(tenantContextOf(evo), { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'Cross tenant', priceMinor: 100, notes: '' })).rejects.toThrow('tenant');
  });
});

describeStore('additional services under concurrent requests', () => {
  it('keeps both changes when a description change and a price change of one additional service run at once', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listAdditionalServices(nexio), store.listAdditionalServices(nexio)]);
    const contract = (await store.listContracts(nexio)).items[0];
    const additional = await store.createAdditionalService(nexio, { customerId: contract.customerId, contractId: contract.id, serviceDate: '2026-10-15', description: 'Workshop', priceMinor: 1000 });

    await Promise.all([store.updateAdditionalService(nexio, additional.id, { description: 'Extended workshop' }), store.updateAdditionalService(nexio, additional.id, { priceMinor: 5000 })]);

    expect((await store.listAdditionalServices(nexio)).items.find((item) => item.id === additional.id)).toMatchObject({ description: 'Extended workshop', priceMinor: 5000 });
  });
});

describeStore('additional service lists', () => {
  it('bills a service in the month of its date, filters by search, status, customer and contract, and refuses a day that does not exist', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const contract = (await store.listContracts(nexio)).items[0];
    const add = (serviceDate: string, description: string) => store.createAdditionalService(nexio, { customerId: contract.customerId, contractId: contract.id, serviceDate, description, priceMinor: 100 });
    const lastDay = await add('2026-10-31', 'Month end visit');
    const firstDay = await add('2026-11-01', 'Month start visit');
    await store.updateAdditionalService(nexio, firstDay.id, { status: 'archived' });
    const ids = async (query: Parameters<typeof store.listAdditionalServices>[1]) => (await store.listAdditionalServices(nexio, { pageSize: 100, ...query })).items.map((item) => item.id);

    expect(await ids({ billingPeriod: '2026-10' })).toEqual([lastDay.id]);
    expect(await ids({ billingPeriod: '2026-11' })).toEqual([firstDay.id]);
    expect(await ids({ billingPeriod: '2026-13' })).toEqual([]);
    await expect(store.listAdditionalServices(nexio, { billingPeriod: '2026-1' })).rejects.toThrow('YYYY-MM');
    expect(await ids({ search: 'month end' })).toEqual([lastDay.id]);
    expect(await ids({ status: 'archived' })).toEqual([firstDay.id]);
    expect(await ids({ customerId: contract.customerId, contractId: contract.id })).toEqual([firstDay.id, lastDay.id]);
    await expect(add('2026-02-31', 'No such day')).rejects.toThrow('Enter a valid service date.');
  });
});