import { expect, it } from 'vitest';
import { describeStore, memberContext, storeForTest, superadmin, signIn } from './test-store';
import { tenantContextOf } from '../auth/principal';

describeStore(['tenants', 'users'], 'tenant users', () => {
  it('refuses to leave a tenant without an active admin', async () => {
    const store = await storeForTest();
    const created = await store.createTenant(superadmin, { name: 'Solo Admin' });
    const adminId = `${created.id}-admin`;
    const admin = (await signIn(store, adminId))!;

    await expect(store.updateTenantUser(tenantContextOf(admin), adminId, { status: 'disabled' })).rejects.toThrow('active admin');
    await expect(store.updateTenantUser(tenantContextOf(admin), adminId, { role: 'user' })).rejects.toThrow('active admin');
    expect(await signIn(store, adminId)).toMatchObject({ role: 'admin' });

    const second = await store.createTenantUser(tenantContextOf(admin), { name: 'Second Admin', email: 'second@solo.demo', role: 'admin' });
    expect((await store.updateTenantUser(tenantContextOf(admin), second.id, { status: 'disabled' })).status).toBe('disabled');
    await expect(store.updateTenantUser(tenantContextOf(admin), adminId, { status: 'disabled' })).rejects.toThrow('active admin');
    await store.updateTenantUser(tenantContextOf(admin), second.id, { status: 'active' });
    expect((await store.updateTenantUser(tenantContextOf(admin), adminId, { role: 'user' })).role).toBe('user');
  });

  it('lets a tenant admin manage only its own users', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin');
    const evo = await signIn(store, 'evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const created = await store.createTenantUser(tenantContextOf(nexio), { name: 'Nexio Accounts', email: 'accounts@nexio.com', role: 'user' });

    expect(await store.listTenantUsers(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, role: 'user', status: 'active' })]));
    expect((await store.listTenantUsers(tenantContextOf(evo))).map((user) => user.email)).not.toContain('accounts@nexio.com');
    expect(await signIn(store, created.id)).toMatchObject({ role: 'user', context: { tenantId: 'nexio' } });
  });

  it('persists an admin role and disabled status for the next soft-login session', async () => {
    const store = await storeForTest();
    const nexio = await signIn(store, 'nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');

    await store.updateTenantUser(tenantContextOf(nexio), 'nexio-user', { role: 'admin', status: 'disabled' });

    expect(await store.listTenantUsers(tenantContextOf(nexio))).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'nexio-user', role: 'admin', status: 'disabled' })]));
    expect(await signIn(store, 'nexio-user')).toBeNull();
  });

  it('rejects user-manager actions from tenant users and cross-tenant targets', async () => {
    const store = await storeForTest();
    const nexioAdmin = await signIn(store, 'nexio-admin');
    const nexioUser = await signIn(store, 'nexio-user');
    if (!nexioAdmin || !nexioUser) throw new Error('Expected seeded sessions');

    await expect(store.listTenantUsers(tenantContextOf(nexioUser))).rejects.toThrow('admin');
    await expect(store.updateTenantUser(tenantContextOf(nexioAdmin), 'evo-user', { status: 'disabled' })).rejects.toThrow('tenant');
  });
});

describeStore(['tenants', 'users'], 'tenant users under concurrent requests', () => {
  it('keeps one active admin when two admins demote each other at once', async () => {
    const store = await storeForTest();
    const first = await memberContext(store, 'nexio-admin');
    await store.updateTenantUser(first, 'nexio-user', { role: 'admin' });
    const second = await memberContext(store, 'nexio-user');
    // Open two pooled connections first, so the racing requests start together instead of one waiting to connect.
    await Promise.all([store.listTenantUsers(first), store.listTenantUsers(second)]);

    const results = await Promise.allSettled([store.updateTenantUser(first, 'nexio-user', { role: 'user' }), store.updateTenantUser(second, 'nexio-admin', { role: 'user' })]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const roles = [await signIn(store, 'nexio-admin'), await signIn(store, 'nexio-user')].map((session) => session?.role);
    expect(roles.filter((role) => role === 'admin')).toHaveLength(1);
  });
});
