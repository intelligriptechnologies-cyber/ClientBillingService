import { afterEach, describe, expect, it } from 'vitest';
import { createTenantStore } from './tenant-store';

const stores: Array<ReturnType<typeof createTenantStore>> = [];

function storeForTest() {
  const store = createTenantStore(':memory:');
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('tenant lifecycle', () => {
  it('lets the superadmin create, change, and disable a tenant while retaining lifecycle history', () => {
    const store = storeForTest();
    const superadmin = store.authenticate('superadmin');
    if (!superadmin) throw new Error('Expected superadmin session');

    const created = store.createTenant(superadmin, { name: 'Northstar Studio' });

    expect(created).toMatchObject({ name: 'Northstar Studio', status: 'active' });
    expect(store.listIdentities().filter((identity) => identity.tenantId === created.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin', tenantName: 'Northstar Studio' }),
      expect.objectContaining({ role: 'user', tenantName: 'Northstar Studio' }),
    ]));

    const updated = store.updateTenant(superadmin, created.id, { name: 'Northstar Creative', status: 'disabled' });
    expect(updated).toMatchObject({ id: created.id, name: 'Northstar Creative', status: 'disabled' });
    expect(store.authenticate(`${created.id}-admin`)).toBeNull();
    expect(store.listTenantHistory(superadmin, created.id).map((event) => event.action)).toEqual(['created', 'updated', 'disabled']);
  });

  it('does not expose tenant lifecycle operations to a tenant session', () => {
    const store = storeForTest();
    const tenantAdmin = store.authenticate('nexio-admin');
    if (!tenantAdmin) throw new Error('Expected tenant admin session');

    expect(() => store.listTenants(tenantAdmin, {})).toThrow('superadmin');
    expect(() => store.createTenant(tenantAdmin, { name: 'Not allowed' })).toThrow('superadmin');
  });
});

describe('tenant store', () => {
  it('seeds five tenants and two tenant-local users for each tenant', () => {
    const store = storeForTest();

    const identities = store.listIdentities();

    expect(identities.filter((identity) => identity.role !== 'superadmin')).toHaveLength(10);
    expect(new Set(identities.filter((identity) => identity.tenantId).map((identity) => identity.tenantId))).toHaveLength(5);
    expect(identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'Admin@nexio.com', role: 'admin', tenantName: 'Nexio Hyper' }),
      expect.objectContaining({ email: 'user@od.com', role: 'user', tenantName: 'OD Badminton' }),
    ]));
  });

  it('does not permit a tenant session to read or write another tenant’s records', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    expect(store.listTenantRecords(nexio).map((record) => record.tenantId)).toEqual([nexio.tenantId]);
    expect(() => store.createTenantRecord(nexio, evo.tenantId!, 'Not allowed')).toThrow('tenant');
  });

  it('lets a tenant admin manage only its own users', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const created = store.createTenantUser(nexio, { name: 'Nexio Accounts', email: 'accounts@nexio.com', role: 'user' });

    expect(store.listTenantUsers(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, role: 'user', status: 'active' })]));
    expect(store.listTenantUsers(evo).map((user) => user.email)).not.toContain('accounts@nexio.com');
    expect(store.authenticate(created.id)).toEqual(expect.objectContaining({ role: 'user', tenantId: 'nexio' }));
  });

  it('persists an admin role and disabled status for the next soft-login session', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');

    store.updateTenantUser(nexio, 'nexio-user', { role: 'admin', status: 'disabled' });

    expect(store.listTenantUsers(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'nexio-user', role: 'admin', status: 'disabled' })]));
    expect(store.authenticate('nexio-user')).toBeNull();
  });

  it('rejects user-manager actions from tenant users and cross-tenant targets', () => {
    const store = storeForTest();
    const nexioAdmin = store.authenticate('nexio-admin');
    const nexioUser = store.authenticate('nexio-user');
    if (!nexioAdmin || !nexioUser) throw new Error('Expected seeded sessions');

    expect(() => store.listTenantUsers(nexioUser)).toThrow('admin');
    expect(() => store.updateTenantUser(nexioAdmin, 'evo-user', { status: 'disabled' })).toThrow('tenant');
  });

  it('creates, filters, changes status, and scopes customers to the active tenant', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const created = store.createCustomer(nexio, { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29ABCDE1234F1Z5', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
    expect(store.listCustomers(nexio, { search: 'meridian' }).items).toEqual([expect.objectContaining({ id: created.id })]);
    expect(store.listCustomers(evo, { search: 'meridian' }).total).toBe(0);
    store.setCustomerStatus(nexio, created.id, 'inactive');
    expect(store.listCustomers(nexio, { status: 'active' }).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    expect(store.listCustomers(nexio, { status: 'inactive' }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
  });

  it('rejects incomplete or invalid customer profiles', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); if (!nexio) throw new Error('Expected seeded session');
    expect(() => store.createCustomer(nexio, { companyName: '', contactName: '', email: 'not-email', phone: '', gstin: '', billingAddress: '', invoiceDelivery: 'monthly' })).toThrow('Company name');
  });
});
