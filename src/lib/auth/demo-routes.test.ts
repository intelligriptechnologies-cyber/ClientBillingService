import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeForTest } from '@/lib/store/test-store';
import * as demoLogin from '../../app/api/auth/demo-login/route';
import * as identities from '../../app/api/auth/identities/route';

const world = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock('@/lib/operational-error', () => ({ recordOperationException: () => undefined }));
vi.mock('@/lib/tenant-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-store')>()),
  getTenantStore: () => world.store,
}));

const authelia = {
  CLIENT_BILLING_AUTH_MODE: 'authelia',
  CBS_PROXY_SECRET: 's'.repeat(32),
  CBS_AUTH_MEMBER_GROUP: 'cbs-users',
  CBS_AUTH_SUPERADMIN_GROUP: 'cbs-superadmin',
  CBS_AUTHELIA_LOGOUT_URL: 'https://auth.example.com/logout',
};

function stubEnv(values: Record<string, string>) {
  for (const key of ['CLIENT_BILLING_ENV', 'CLIENT_BILLING_AUTH_MODE']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

const login = (userId: string) => new Request('http://localhost/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ userId }) });

beforeEach(async () => { world.store = await storeForTest(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('demo auth routes', () => {
  it('sign in and list identities in demo mode, the default', async () => {
    stubEnv({});
    const list = await identities.GET();
    expect(list.status).toBe(200);
    const listed = ((await list.json()) as { identities: Array<{ id: string; role: string }> }).identities;
    expect(listed.filter((identity) => identity.role === 'superadmin').map((identity) => identity.id)).toEqual(['superadmin']);
    expect(listed.filter((identity) => identity.role !== 'superadmin')).toHaveLength(10);
    const response = await demoLogin.POST(login('superadmin'));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-cbs_demo=platform;.*Path=\/.*Secure/i)]);
    const member = await demoLogin.POST(login('nexio-admin'));
    expect(await member.json()).toMatchObject({ identity: { id: 'nexio-admin', role: 'admin', tenantId: 'nexio' } });
    expect(member.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-cbs_demo=nexio-admin;.*Path=\/.*Secure/i), expect.stringMatching(/^__Host-cbs_tenant=nexio;.*Path=\/.*Secure/i)]);
    expect(member.headers.getSetCookie().join('\n')).not.toContain('client-billing-demo-session');
    expect((await demoLogin.POST(login('no-such-user'))).status).toBe(400);
  });

  it.each([
    ['authelia mode', authelia],
    ['production', { CLIENT_BILLING_ENV: 'production' }],
    ['production with a typo in the mode', { CLIENT_BILLING_ENV: 'production', CLIENT_BILLING_AUTH_MODE: 'demoo' }],
    ['a refused authelia config', { CLIENT_BILLING_AUTH_MODE: 'authelia' }],
  ])('return 404 under %s and set no cookie', async (_label, env) => {
    stubEnv(env);
    const response = await demoLogin.POST(login('superadmin'));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await identities.GET()).status).toBe(404);
  });
});
