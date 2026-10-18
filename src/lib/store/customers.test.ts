import { expect, it } from 'vitest';
import { describeStore, storeForTest } from './test-store';

describeStore(['customers'], 'customers', () => {
  it('creates, filters, changes status, and scopes customers to the active tenant', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin'); const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const created = await store.createCustomer(nexio, { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29AAGCB7383J1Z4', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
    expect((await store.listCustomers(nexio, { search: 'meridian' })).items).toEqual([expect.objectContaining({ id: created.id })]);
    expect((await store.listCustomers(evo, { search: 'meridian' })).total).toBe(0);
    await store.setCustomerStatus(nexio, created.id, 'inactive');
    expect((await store.listCustomers(nexio, { status: 'active' })).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    expect((await store.listCustomers(nexio, { status: 'inactive' })).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
  });

  it('rejects incomplete or invalid customer profiles', async () => {
    const store = await storeForTest(); const nexio = await store.authenticate('nexio-admin'); if (!nexio) throw new Error('Expected seeded session');
    await expect(store.createCustomer(nexio, { companyName: '', contactName: '', email: 'not-email', phone: '', gstin: '', billingAddress: '', invoiceDelivery: 'monthly' })).rejects.toThrow('Company name');
  });
});
