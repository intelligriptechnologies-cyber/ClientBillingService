import { expect, it } from 'vitest';
import { describeStore, storeForTest } from './test-store';

describeStore(['tenants'], 'tenant lifecycle', () => {
  it('lets the superadmin create, change, and disable a tenant while retaining lifecycle history', async () => {
    const store = await storeForTest();
    const superadmin = await store.authenticate('superadmin');
    if (!superadmin) throw new Error('Expected superadmin session');

    const created = await store.createTenant(superadmin, { name: 'Northstar Studio' });

    expect(created).toMatchObject({ name: 'Northstar Studio', status: 'active' });
    expect((await store.listIdentities()).filter((identity) => identity.tenantId === created.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin', tenantName: 'Northstar Studio' }),
      expect.objectContaining({ role: 'user', tenantName: 'Northstar Studio' }),
    ]));

    const updated = await store.updateTenant(superadmin, created.id, { name: 'Northstar Creative', status: 'disabled' });
    expect(updated).toMatchObject({ id: created.id, name: 'Northstar Creative', status: 'disabled' });
    expect(await store.authenticate(`${created.id}-admin`)).toBeNull();
    expect((await store.listTenantHistory(superadmin, created.id)).map((event) => event.action)).toEqual(['created', 'updated', 'disabled']);
  });

  it('does not expose tenant lifecycle operations to a tenant session', async () => {
    const store = await storeForTest();
    const tenantAdmin = await store.authenticate('nexio-admin');
    if (!tenantAdmin) throw new Error('Expected tenant admin session');

    await expect(store.listTenants(tenantAdmin, {})).rejects.toThrow('superadmin');
    await expect(store.createTenant(tenantAdmin, { name: 'Not allowed' })).rejects.toThrow('superadmin');
  });

  it('lets the superadmin change only the capitalisation of a tenant name', async () => {
    const store = await storeForTest();
    const superadmin = (await store.authenticate('superadmin'))!;
    const created = await store.createTenant(superadmin, { name: 'Harbour Works' });

    expect((await store.updateTenant(superadmin, created.id, { name: 'HARBOUR WORKS' })).name).toBe('HARBOUR WORKS');
    const other = await store.createTenant(superadmin, { name: 'Other Works' });
    await expect(store.updateTenant(superadmin, other.id, { name: 'harbour works' })).rejects.toThrow('already exists');
  });

  it('rejects empty, blank, duplicate and non-text tenant names with a readable message', async () => {
    const store = await storeForTest();
    const superadmin = (await store.authenticate('superadmin'))!;
    await store.createTenant(superadmin, { name: 'Unique Co' });

    await expect(store.createTenant(superadmin, { name: '' })).rejects.toThrow('between 2 and 100');
    await expect(store.createTenant(superadmin, { name: '   ' })).rejects.toThrow('between 2 and 100');
    await expect(store.createTenant(superadmin, { name: ' unique   CO ' })).rejects.toThrow('already exists');
    await expect(store.createTenant(superadmin, { name: 42 as unknown as string })).rejects.toThrow('Tenant name is required');
    await expect(store.updateTenant(superadmin, 'missing-tenant', { name: 'Whatever' })).rejects.toThrow('not found');
  });

  it('treats the tenant search text literally rather than as a LIKE pattern', async () => {
    const store = await storeForTest();
    const superadmin = (await store.authenticate('superadmin'))!;
    expect((await store.listTenants(superadmin, { query: '%' })).total).toBe(0);
    expect((await store.listTenants(superadmin, { query: '_' })).total).toBe(0);
  });

  it('suspends and reactivates a tenant, blocking its sign-in meanwhile, and records each step', async () => {
    const store = await storeForTest();
    const superadmin = (await store.authenticate('superadmin'))!;
    const created = await store.createTenant(superadmin, { name: 'Pause Me' });
    const adminId = `${created.id}-admin`;

    await store.updateTenant(superadmin, created.id, { status: 'disabled' });
    expect(await store.authenticate(adminId)).toBeNull();
    await store.updateTenant(superadmin, created.id, { status: 'disabled' });
    await store.updateTenant(superadmin, created.id, { status: 'active' });
    expect(await store.authenticate(adminId)).toMatchObject({ tenantId: created.id, role: 'admin' });
    await expect(store.updateTenant(superadmin, created.id, { status: 'archived' as never })).rejects.toThrow('status is invalid');
    expect((await store.listTenantHistory(superadmin, created.id)).map((event) => event.action)).toEqual(['created', 'disabled', 'enabled']);
  });
});

describeStore(['tenants'], 'tenant identities and records', () => {
  it('seeds five tenants and two tenant-local users for each tenant', async () => {
    const store = await storeForTest();

    const identities = await store.listIdentities();

    expect(identities.filter((identity) => identity.role !== 'superadmin')).toHaveLength(10);
    expect(new Set(identities.filter((identity) => identity.tenantId).map((identity) => identity.tenantId))).toHaveLength(5);
    expect(identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'Admin@nexio.com', role: 'admin', tenantName: 'Nexio Hyper' }),
      expect.objectContaining({ email: 'user@od.com', role: 'user', tenantName: 'OD Badminton' }),
    ]));
  });

  it('does not permit a tenant session to read or write another tenant’s records', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    expect((await store.listTenantRecords(nexio)).map((record) => record.tenantId)).toEqual([nexio.tenantId]);
    await expect(store.createTenantRecord(nexio, evo.tenantId!, 'Not allowed')).rejects.toThrow('tenant');
  });
});
