import { expect, it } from 'vitest';
import { describeStore, storeForTest, superadmin } from './test-store';
import { tenantContextOf } from '../auth/session-context';

describeStore(['tenants', 'users'], 'tenant users', () => {
  it('refuses to leave a tenant without an active admin', async () => {
    const store = await storeForTest();
    const created = await store.createTenant(superadmin, { name: 'Solo Admin' });
    const admin = (await store.authenticate(`${created.id}-admin`))!;

    await expect(store.updateTenantUser(tenantContextOf(admin), admin.id, { status: 'disabled' })).rejects.toThrow('active admin');
    await expect(store.updateTenantUser(tenantContextOf(admin), admin.id, { role: 'user' })).rejects.toThrow('active admin');
    expect(await store.authenticate(admin.id)).toMatchObject({ role: 'admin' });

    const second = await store.createTenantUser(tenantContextOf(admin), { name: 'Second Admin', email: 'second@solo.demo', role: 'admin' });
    expect((await store.updateTenantUser(tenantContextOf(admin), second.id, { status: 'disabled' })).status).toBe('disabled');
    await expect(store.updateTenantUser(tenantContextOf(admin), admin.id, { status: 'disabled' })).rejects.toThrow('active admin');
    await store.updateTenantUser(tenantContextOf(admin), second.id, { status: 'active' });
    expect((await store.updateTenantUser(tenantContextOf(admin), admin.id, { role: 'user' })).role).toBe('user');
  });

  it('lets a tenant admin manage only its own users', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    const evo = await store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const created = await store.createTenantUser(tenantContextOf(nexio), { name: 'Nexio Accounts', email: 'accounts@nexio.com', role: 'user' });

    expect(await store.listTenantUsers(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, role: 'user', status: 'active' })]));
    expect((await store.listTenantUsers(tenantContextOf(evo))).map((user) => user.email)).not.toContain('accounts@nexio.com');
    expect(await store.authenticate(created.id)).toEqual(expect.objectContaining({ role: 'user', tenantId: 'nexio' }));
  });

  it('persists an admin role and disabled status for the next soft-login session', async () => {
    const store = await storeForTest();
    const nexio = await store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');

    await store.updateTenantUser(tenantContextOf(nexio), 'nexio-user', { role: 'admin', status: 'disabled' });

    expect(await store.listTenantUsers(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'nexio-user', role: 'admin', status: 'disabled' })]));
    expect(await store.authenticate('nexio-user')).toBeNull();
  });

  it('rejects user-manager actions from tenant users and cross-tenant targets', async () => {
    const store = await storeForTest();
    const nexioAdmin = await store.authenticate('nexio-admin');
    const nexioUser = await store.authenticate('nexio-user');
    if (!nexioAdmin || !nexioUser) throw new Error('Expected seeded sessions');

    await expect(store.listTenantUsers(tenantContextOf(nexioUser))).rejects.toThrow('admin');
    await expect(store.updateTenantUser(tenantContextOf(nexioAdmin), 'evo-user', { status: 'disabled' })).rejects.toThrow('tenant');
  });
});
