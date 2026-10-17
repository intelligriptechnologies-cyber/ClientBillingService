import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

function stubEnv(values: Record<string, string>) {
  for (const key of ['CLIENT_BILLING_ENV', 'CLIENT_BILLING_AUTH_MODE', 'CBS_PUBLIC_ORIGIN']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3100${path}`, { method: init.method ?? 'GET', headers: { host: 'localhost:3100', ...init.headers } });
}

const passedThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';

afterEach(() => vi.unstubAllEnvs());

describe('proxy origin check', () => {
  it('rejects a cookie POST from a foreign Origin and one with no Origin', async () => {
    stubEnv({});
    const cookie = { cookie: 'client-billing-demo-session=nexio-admin' };
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

describe('proxy with a refused config', () => {
  it('fails closed, including the health check, so a mis-set production never serves demo', () => {
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
    expect(matches('/_next/static/chunks/a.js')).toBe(false);
  });
});
