import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest } from './test-store';
import { tenantContextOf } from '../auth/session-context';

describeStore(['customers', 'services', 'contracts', 'deposits'], 'contracts and security deposits', () => {
  it('creates a tenant-scoped quarterly contract with its opening security deposit', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const service = await store.createService(tenantContextOf(nexio), { name: 'Analytics support', prices: { monthly: 100000, quarterly: 280000, halfYearly: 540000, annual: 1000000 } });
    if (!customer) throw new Error('Expected seeded customer');

    const contract = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [service.id], name: 'FY26 analytics support', startDate: '2026-04-01', endDate: '2027-03-31',
      valueMinor: 1200000, paymentTermsDays: 14, billingFrequency: 'quarterly', invoiceMonths: [4, 7, 10], cycleDay: 5,
      escalationPercent: 8, escalationReviewDate: '2027-04-01', renewalNoticeDays: 45, securityDepositMinor: 250000,
    });

    expect(contract).toMatchObject({ customerId: customer.id, billingFrequency: 'quarterly', invoiceMonths: [4, 7, 10], status: 'active' });
    expect(await store.listSecurityDeposits(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: contract.id, amountMinor: 250000, status: 'held' })]));
    expect((await store.listContracts(tenantContextOf(evo), {})).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: contract.id })]));
  });

  it('tracks renewals and settles a held deposit once without crossing tenant boundaries', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const service = (await store.listServices(tenantContextOf(nexio)))[0];
    if (!customer || !service) throw new Error('Expected seeded customer and service');
    const contract = await store.createContract(tenantContextOf(nexio), {
      customerId: customer.id, serviceIds: [service.id], name: 'Renewal and deposit contract', startDate: '2025-01-01', endDate: '2026-10-01',
      valueMinor: 1200000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 5,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 45, securityDepositMinor: 250000,
    });

    expect((await store.listRenewals(tenantContextOf(nexio), { status: 'expired' })).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ contractId: contract.id, renewalStatus: 'expired' }),
    ]));
    const renewed = await store.renewContract(tenantContextOf(nexio), contract.id, { endDate: '2027-10-01', note: 'Customer confirmed another year.' });
    expect(renewed.endDate).toBe('2027-10-01');
    expect((await store.listContractAudit(tenantContextOf(nexio), contract.id)).map((event) => event.action)).toContain('renewed');

    const deposit = (await store.listSecurityDeposits(tenantContextOf(nexio))).find((item) => item.contractId === contract.id);
    if (!deposit) throw new Error('Expected opening deposit');
    expect(await store.settleSecurityDeposit(tenantContextOf(nexio), deposit.id, { amountMinor: 250000, note: 'Customer closeout refund.' })).toMatchObject({ status: 'settled', settledMinor: 250000 });
    await expect(store.settleSecurityDeposit(tenantContextOf(nexio), deposit.id, { amountMinor: 1, note: 'Duplicate' })).rejects.toThrow('already been settled');
    await expect(store.settleSecurityDeposit(tenantContextOf(evo), deposit.id, { amountMinor: 250000, note: 'Cross-tenant' })).rejects.toThrow('tenant');
  });

  it('rejects an invalid invoice-month schedule and cross-tenant contract references', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = (await store.listCustomers(tenantContextOf(nexio), {})).items[0];
    const service = await store.createService(tenantContextOf(nexio), { name: 'Analytics support', prices: { monthly: 100000, quarterly: 280000, halfYearly: 540000, annual: 1000000 } });
    if (!customer) throw new Error('Expected seeded customer');
    const input = { customerId: customer.id, serviceIds: [service.id], name: 'Invalid schedule', startDate: '2026-04-01', endDate: '2027-03-31', valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'quarterly' as const, invoiceMonths: [4, 7], cycleDay: 1, escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0 };
    await expect(store.createContract(tenantContextOf(nexio), input)).rejects.toThrow('3 invoice months');
    await expect(store.createContract(tenantContextOf(evo), { ...input, invoiceMonths: [4, 7, 10] })).rejects.toThrow('customer');
  });
});

describeStore(['customers', 'services', 'contracts', 'deposits'], 'contracts and security deposits under concurrent requests', () => {
  async function withContract(securityDepositMinor = 0) {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listContracts(nexio), store.listContracts(nexio)]);
    const customer = (await store.listCustomers(nexio)).items[0];
    const service = (await store.listServices(nexio))[0];
    const contract = await store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'Raced contract', startDate: '2026-01-01', endDate: '2026-12-31', valueMinor: 100000, paymentTermsDays: 14,
      billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1, escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor,
    });
    return { store, nexio, contract };
  }

  it('never settles more than a deposit holds when two settlements run at once', async () => {
    const { store, nexio, contract } = await withContract(100000);
    const deposit = (await store.listSecurityDeposits(nexio)).find((item) => item.contractId === contract.id)!;

    const results = await Promise.allSettled([60000, 60000].map((amountMinor) => store.settleSecurityDeposit(nexio, deposit.id, { amountMinor, note: 'Refund' })));

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await store.listSecurityDeposits(nexio)).find((item) => item.id === deposit.id)).toMatchObject({ settledMinor: 60000, balanceMinor: 40000, status: 'held' });
    expect((await store.listContractAudit(nexio, contract.id)).filter((event) => event.action === 'deposit-settled')).toHaveLength(1);
  });

  it('keeps both changes when a rename and a value change of one contract run at once', async () => {
    const { store, nexio, contract } = await withContract();

    await Promise.all([store.updateContract(nexio, contract.id, { name: 'Renamed contract' }), store.updateContract(nexio, contract.id, { valueMinor: 250000 })]);

    expect((await store.listContracts(nexio)).items.find((item) => item.id === contract.id)).toMatchObject({ name: 'Renamed contract', valueMinor: 250000, serviceIds: contract.serviceIds });
  });

  it('never moves the end date back when two renewals run at once', async () => {
    const { store, nexio, contract } = await withContract();

    // Which request writes last varies from run to run, so five rounds make a lost renewal show up in nearly every run.
    for (let year = 2028; year < 2038; year += 2) {
      await Promise.allSettled([store.renewContract(nexio, contract.id, { endDate: `${year + 1}-12-31`, note: 'Later' }), store.renewContract(nexio, contract.id, { endDate: `${year}-12-31`, note: 'Earlier' })]);
      expect((await store.listContracts(nexio)).items.find((item) => item.id === contract.id)?.endDate).toBe(`${year + 1}-12-31`);
    }
  });
});