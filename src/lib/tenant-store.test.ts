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
});
