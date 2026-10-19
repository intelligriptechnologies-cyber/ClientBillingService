import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore('customers', () => {
  it('creates, filters, changes status, and scopes customers to the active tenant', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin'); const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const created = await store.createCustomer(tenantContextOf(nexio), { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29AAGCB7383J1Z4', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
    expect((await store.listCustomers(tenantContextOf(nexio), { search: 'meridian' })).items).toEqual([expect.objectContaining({ id: created.id })]);
    expect((await store.listCustomers(tenantContextOf(evo), { search: 'meridian' })).total).toBe(0);
    await store.setCustomerStatus(tenantContextOf(nexio), created.id, 'inactive');
    expect((await store.listCustomers(tenantContextOf(nexio), { status: 'active' })).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    expect((await store.listCustomers(tenantContextOf(nexio), { status: 'inactive' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
  });

  it('rejects incomplete or invalid customer profiles', async () => {
    const store = await storeForTest(); const nexio = await signIn(store, 'nexio-admin'); if (!nexio) throw new Error('Expected seeded session');
    await expect(store.createCustomer(tenantContextOf(nexio), { companyName: '', contactName: '', email: 'not-email', phone: '', gstin: '', billingAddress: '', invoiceDelivery: 'monthly' })).rejects.toThrow('Company name');
  });
});

describeStore('customer lists', () => {
  it('filters by month and delivery, pages, searches LIKE patterns literally, and orders company names bytewise', async () => {
    const store = await storeForTest();
    const nexio = await memberContext(store, 'nexio-admin');
    const base = { contactName: 'Contact', email: 'c@example.com', phone: '1', gstin: '', billingAddress: 'Somewhere' };
    const created = [];
    for (const [companyName, invoiceDelivery] of [['beta Zq', 'email'], ['Alpha Zq', 'manual'], ['alpha Zq', 'email']] as const) created.push(await store.createCustomer(nexio, { ...base, companyName, invoiceDelivery }));
    const month = created[0].createdAt.slice(0, 7);
    const names = async (query: Parameters<typeof store.listCustomers>[1]) => (await store.listCustomers(nexio, { search: 'zq', pageSize: 100, ...query })).items.map((item) => item.companyName);

    expect(await names({ month })).toEqual(['Alpha Zq', 'alpha Zq', 'beta Zq']);
    expect(await names({ month: '' })).toEqual(['Alpha Zq', 'alpha Zq', 'beta Zq']);
    expect(await names({ month: '2000-01' })).toEqual([]);
    expect(await names({ month: '2026-13' })).toEqual([]);
    expect(await names({ invoiceDelivery: 'email' })).toEqual(['alpha Zq', 'beta Zq']);
    expect(await store.listCustomers(nexio, { search: 'zq', page: 2, pageSize: 2 })).toMatchObject({ total: 3, items: [expect.objectContaining({ companyName: 'beta Zq' })] });

    await store.createCustomer(nexio, { ...base, companyName: 'back\\slash Zq', invoiceDelivery: 'manual' });
    expect(await names({ search: 'back\\slash' })).toEqual(['back\\slash Zq']);
    expect(await names({ search: 'a%zq' })).toEqual(['Alpha Zq', 'alpha Zq', 'back\\slash Zq', 'beta Zq']);
  });
});