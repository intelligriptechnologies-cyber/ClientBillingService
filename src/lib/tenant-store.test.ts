import { afterEach, describe, expect, it } from 'vitest';
import { createTenantStore } from './tenant-store';

const stores: Array<ReturnType<typeof createTenantStore>> = [];
function storeForTest() { const store = createTenantStore(':memory:'); stores.push(store); return store; }
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

describe('tenant store', () => {
  it('seeds five tenants and two tenant-local users for each tenant', () => {
    const identities = storeForTest().listIdentities();
    expect(identities.filter((identity) => identity.role !== 'superadmin')).toHaveLength(10);
    expect(new Set(identities.filter((identity) => identity.tenantId).map((identity) => identity.tenantId))).toHaveLength(5);
    expect(identities).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'Admin@nexio.com', role: 'admin', tenantName: 'Nexio Hyper' })]));
  });

  it('does not permit a tenant session to read or write another tenant’s records', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    expect(store.listTenantRecords(nexio).map((record) => record.tenantId)).toEqual([nexio.tenantId]);
    expect(() => store.createTenantRecord(nexio, evo.tenantId!, 'Not allowed')).toThrow('tenant');
  });

  it('creates, filters, changes status, and scopes customers to the active tenant', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const created = store.createCustomer(nexio, { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29ABCDE1234F1Z5', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
    expect(store.listCustomers(nexio, { search: 'meridian' }).items).toEqual([expect.objectContaining({ id: created.id, companyName: 'Meridian Labs' })]);
    expect(store.listCustomers(evo, { search: 'meridian' }).total).toBe(0);
    expect(store.setCustomerStatus(nexio, created.id, 'inactive')).toEqual(expect.objectContaining({ status: 'inactive' }));
    expect(store.listCustomers(nexio, { status: 'active' }).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    expect(store.listCustomers(nexio, { status: 'inactive' }).items).toEqual([expect.objectContaining({ id: created.id })]);
  });

  it('rejects incomplete or invalid customer profiles', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); if (!nexio) throw new Error('Expected seeded session');
    expect(() => store.createCustomer(nexio, { companyName: '', contactName: '', email: 'not-email', phone: '', gstin: '', billingAddress: '', invoiceDelivery: 'monthly' })).toThrow('Company name');
  });
});
