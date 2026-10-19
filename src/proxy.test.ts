import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

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
  for (const key of ['CLIENT_BILLING_ENV', 'CLIENT_BILLING_AUTH_MODE', 'CBS_PUBLIC_ORIGIN']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3100${path}`, { method: init.method ?? 'GET', headers: { host: 'localhost:3100', ...init.headers } });
}

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';
const forwardedRequestHeaders = (response: Response) => (response.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean);

afterEach(() => vi.unstubAllEnvs());

describe('proxy origin check', () => {
  it('rejects a cookie POST from a foreign Origin and one with no Origin', async () => {
    stubEnv({});
    const cookie = { cookie: '__Host-cbs_demo=nexio-admin' };
    const foreign = proxy(request('/api/customers', { method: 'POST', headers: { ...cookie, origin: 'https://evil.example' } }));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ message: 'Cross-origin request refused.' });
    expect(proxy(request('/api/customers', { method: 'POST', headers: cookie })).status).toBe(403);
  });

  it('passes a same-origin cookie POST', () => {
    stubEnv({});
    const response = proxy(request('/api/customers', { method: 'POST', headers: { cookie: 'a=b', origin: 'http://localhost:3100' } }));
    expect(passedThrough(response)).toBe(true);
  });

  it('passes a bearer POST to /api/v1/* with no cookie and no Origin', () => {
    stubEnv({});
    expect(passedThrough(proxy(request('/api/v1/invoices', { method: 'POST', headers: { authorization: 'Bearer cbs_a_b' } })))).toBe(true);
  });

  it('passes a GET with a foreign Origin', () => {
    stubEnv({});
    expect(passedThrough(proxy(request('/api/customers', { headers: { cookie: 'a=b', origin: 'https://evil.example' } })))).toBe(true);
  });

  it('uses CBS_PUBLIC_ORIGIN when set', () => {
    stubEnv({ CBS_PUBLIC_ORIGIN: 'https://billing.example.com' });
    expect(passedThrough(proxy(request('/api/customers', { method: 'POST', headers: { cookie: 'a=b', origin: 'https://billing.example.com' } })))).toBe(true);
    expect(proxy(request('/api/customers', { method: 'POST', headers: { cookie: 'a=b', origin: 'http://localhost:3100' } })).status).toBe(403);
  });
});

describe('proxy in authelia mode', () => {
  const identity = { 'remote-user': 'alice', 'remote-groups': 'cbs-users' };

  it.each(['/dashboard', '/api/customers', '/api/auth/me', '/api/v1/ping', '/'])('returns 401 for %s without the proxy secret', async (path) => {
    stubEnv(authelia);
    const response = proxy(request(path, { headers: identity }));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(secret);
  });

  it.each([
    ['same length but wrong', 'x'.repeat(secret.length)],
    ['shorter', 'short'],
  ])('returns 401 with a %s secret', (_label, value) => {
    stubEnv(authelia);
    expect(proxy(request('/dashboard', { headers: { ...identity, 'x-cbs-proxy-secret': value } })).status).toBe(401);
  });

  it('answers /api/health without a secret, and only that path', () => {
    stubEnv(authelia);
    expect(passedThrough(proxy(request('/api/health')))).toBe(true);
    expect(proxy(request('/api/health/extra')).status).toBe(401);
    expect(proxy(request('//api/health')).status).toBe(401);
  });

  it('passes a request that carries the secret', () => {
    stubEnv(authelia);
    expect(passedThrough(proxy(request('/dashboard', { headers: { ...identity, 'x-cbs-proxy-secret': secret } })))).toBe(true);
  });

  it('checks Origin on every POST, whether or not a cookie arrives', () => {
    stubEnv({ ...authelia, CBS_PUBLIC_ORIGIN: 'https://billing.example.com' });
    const headers = { ...identity, 'x-cbs-proxy-secret': secret };
    expect(proxy(request('/api/customers', { method: 'POST', headers })).status).toBe(403);
    expect(passedThrough(proxy(request('/api/customers', { method: 'POST', headers: { ...headers, origin: 'https://billing.example.com' } })))).toBe(true);
  });

  it('still requires the secret on a bearer POST to /api/v1/*', () => {
    stubEnv(authelia);
    expect(proxy(request('/api/v1/invoices', { method: 'POST', headers: { authorization: 'Bearer cbs_a_b' } })).status).toBe(401);
  });

  it('never forwards Remote-* headers to /api/v1/*', () => {
    stubEnv(authelia);
    const headers = { 'x-cbs-proxy-secret': secret, authorization: 'Bearer cbs_a_b', 'remote-user': 'admin', 'remote-groups': 'cbs-superadmin', 'remote-email': 'a@b.c', 'remote-name': 'Admin' };
    const response = proxy(request('/api/v1/ping', { headers }));
    expect(passedThrough(response)).toBe(true);
    const forwarded = forwardedRequestHeaders(response);
    expect(forwarded).toContain('authorization');
    expect(forwarded.filter((name) => name.startsWith('remote-'))).toEqual([]);
    expect([...response.headers.keys()].filter((name) => name.startsWith('x-middleware-request-remote-'))).toEqual([]);
  });

  it('keeps Remote-* on routes that rely on the forwarded identity', () => {
    stubEnv(authelia);
    const response = proxy(request('/api/auth/me', { headers: { ...identity, 'x-cbs-proxy-secret': secret } }));
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
  });
});

describe('proxy with a refused config', () => {
  it('fails closed, including the health check, so a mis-set production never serves demo', async () => {
    stubEnv({ CLIENT_BILLING_ENV: 'production' });
    expect((proxy(request('/dashboard'))).status).toBe(503);
    expect((proxy(request('/api/health'))).status).toBe(503);
  });
});

describe('proxy matcher', () => {
  it('skips only static build assets', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
    expect(matches('/dashboard')).toBe(true);
    expect(matches('/')).toBe(true);
    expect(matches('/api/auth/me')).toBe(true);
    expect(matches('/api/v1/ping')).toBe(true);
    expect(matches('/_next/static/chunks/a.js')).toBe(false);
  });
});
