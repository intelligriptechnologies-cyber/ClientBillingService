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

  it('persists frequency-aware services and tenant-scoped quotations', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const service = store.createService(nexio, {
      name: 'Managed analytics',
      description: 'Monthly reporting and advisory',
      prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 },
    });
    const quotation = store.createQuotation(nexio, {
      customerName: 'Acme Trading',
      customerEmail: 'accounts@acme.example',
      lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 2 }],
    });

    expect(store.listServices(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: service.id, prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 } })]));
    expect(quotation).toMatchObject({ customerName: 'Acme Trading', totalMinor: 300000, lines: [expect.objectContaining({ serviceName: 'Managed analytics', unitPriceMinor: 150000 })] });
    expect(store.listQuotations(evo)).toEqual([]);
    expect(() => store.getQuotation(evo, quotation.id)).toThrow('tenant');
  });

  it('rejects invalid service prices and quotation lines from another tenant', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const service = store.createService(nexio, { name: 'Reporting', prices: { monthly: 1000, quarterly: 0, halfYearly: 0, annual: 0 } });

    expect(() => store.createService(nexio, { name: 'Broken', prices: { monthly: -1, quarterly: 0, halfYearly: 0, annual: 0 } })).toThrow('non-negative');
    expect(() => store.createQuotation(evo, { customerName: 'Other customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] })).toThrow('tenant');
  });
});
