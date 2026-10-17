import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { GET as ping } from '../../v1/ping/route';

const secret = 'proxy-secret-proxy-secret-proxy-s';
const authelia = {
  CLIENT_BILLING_AUTH_MODE: 'authelia',
  CLIENT_BILLING_ENV: 'staging',
  CBS_PROXY_SECRET: secret,
  CBS_AUTH_MEMBER_GROUP: 'cbs-users',
  CBS_AUTH_SUPERADMIN_GROUP: 'cbs-superadmin',
  CBS_AUTHELIA_LOGOUT_URL: 'https://auth.example.com/logout',
};

function stubEnv(values: Record<string, string>) {
  for (const key of ['CLIENT_BILLING_ENV', 'CLIENT_BILLING_AUTH_MODE']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

const call = (headers: Record<string, string>) => GET(new Request('http://localhost/api/auth/me', { headers }));
const signedIn = { 'x-cbs-proxy-secret': secret, 'remote-user': 'alice', 'remote-groups': 'cbs-users', 'remote-email': 'alice@example.com', 'remote-name': 'Alice A' };

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/auth/me', () => {
  it('returns the parsed identity and the access the groups grant', async () => {
    stubEnv(authelia);
    const response = await call(signedIn);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ principal: 'member', identity: { username: 'alice', email: 'alice@example.com', name: 'Alice A', groups: ['cbs-users'] } });
  });

  it('reports the superadmin group as platform', async () => {
    stubEnv(authelia);
    expect(await (await call({ ...signedIn, 'remote-groups': 'cbs-superadmin' })).json()).toMatchObject({ principal: 'platform' });
  });

  it('returns 401 without the proxy secret, even with a valid identity', async () => {
    stubEnv(authelia);
    expect((await call({ ...signedIn, 'x-cbs-proxy-secret': '' })).status).toBe(401);
  });

  it('returns 401 for an empty Remote-User and 403 for a user outside both groups', async () => {
    stubEnv(authelia);
    expect((await call({ ...signedIn, 'remote-user': '' })).status).toBe(401);
    expect((await call({ ...signedIn, 'remote-groups': 'other' })).status).toBe(403);
  });

  it('returns 404 in demo mode, where nothing forwards an identity', async () => {
    stubEnv({});
    expect((await call(signedIn)).status).toBe(404);
  });
});

describe('GET /api/v1/ping', () => {
  it('reports the Remote-User header it received so the edge tests can see that none arrives', async () => {
    expect(await (await ping(new Request('http://localhost/api/v1/ping', { headers: { 'remote-user': 'admin' } }))).json()).toEqual({ ok: true, remoteUser: 'admin' });
    expect(await (await ping(new Request('http://localhost/api/v1/ping'))).json()).toEqual({ ok: true, remoteUser: null });
  });
});
