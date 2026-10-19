import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoCookie, tenantCookie } from '@/lib/auth/resolve';
import { POST } from './route';

vi.mock('@/lib/operational-error', () => ({ recordOperationException: () => undefined }));

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

const cleared = (response: Response) => response.headers.getSetCookie().filter((cookie) => /Max-Age=0/i.test(cookie) && /Secure/i.test(cookie) && /Path=\//i.test(cookie)).map((cookie) => cookie.split('=')[0]).sort();

afterEach(() => { vi.unstubAllEnvs(); });

describe('POST /api/auth/logout', () => {
  it('clears both cookies and hands the browser the Authelia logout URL in authelia mode', async () => {
    stubEnv(authelia);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ logoutUrl: 'https://auth.example.com/logout' });
    expect(cleared(response)).toEqual([demoCookie, tenantCookie].sort());
  });

  it('clears both cookies and has no portal to visit in demo mode', async () => {
    stubEnv({});
    const response = await POST();
    expect(await response.json()).toEqual({ logoutUrl: null });
    expect(cleared(response)).toEqual([demoCookie, tenantCookie].sort());
  });
});
