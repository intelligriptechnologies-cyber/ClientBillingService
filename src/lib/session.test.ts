import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeForTest } from '@/lib/store/test-store';
import { getCurrentSession, sessionCookie } from './session';

const world = vi.hoisted(() => ({ store: undefined as unknown, cookie: undefined as string | undefined }));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'client-billing-demo-session' && world.cookie ? { name, value: world.cookie } : undefined) }) }));
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

beforeEach(async () => { world.store = await storeForTest(); world.cookie = 'superadmin'; });
afterEach(() => { vi.unstubAllEnvs(); });

describe('getCurrentSession', () => {
  it('reads the demo cookie in demo mode', async () => {
    stubEnv({});
    expect(sessionCookie).toBe('client-billing-demo-session');
    expect(await getCurrentSession()).toMatchObject({ id: 'superadmin', role: 'superadmin' });
  });

  it.each([
    ['authelia mode, so a signed-in member cannot forge the superadmin by setting the demo cookie', authelia],
    ['production', { CLIENT_BILLING_ENV: 'production' }],
  ])('ignores the demo cookie under %s', async (_label, env) => {
    stubEnv(env);
    expect(await getCurrentSession()).toBeNull();
  });
});
