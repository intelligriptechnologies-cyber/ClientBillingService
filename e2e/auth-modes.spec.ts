import { expect, test, type APIRequestContext, type Playwright } from '@playwright/test';
import { autheliaOrigin, demoOrigin, memberGroup, proxySecret, superadminGroup } from './test-ports';

const sessionCookie = 'client-billing-demo-session';

// A context with no config-level headers, so each request carries exactly what the test gives it.
const bare = (playwright: Playwright, baseURL: string) => playwright.request.newContext({ baseURL, extraHTTPHeaders: {} });

test.describe('demo mode', () => {
  test('keeps the identity picker and demo sign-in working', async ({ playwright }) => {
    const request = await bare(playwright, demoOrigin);
    const identities = await request.get('/api/auth/identities');
    expect(identities.status()).toBe(200);
    expect(((await identities.json()) as { identities: Array<{ id: string }> }).identities.map((identity) => identity.id)).toContain('superadmin');
    const login = await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    expect(login.status()).toBe(200);
    expect((await request.get('/api/customers?pageSize=1', { headers: { origin: demoOrigin } })).status()).toBe(200);
    await request.dispose();
  });

  test('has no raw-user-id login route and no forwarded identity route', async ({ playwright }) => {
    const request = await bare(playwright, demoOrigin);
    expect((await request.post('/api/auth/login', { data: { userId: 'superadmin' } })).status()).toBe(404);
    expect((await request.get('/api/auth/me')).status()).toBe(404);
    await request.dispose();
  });

  test('refuses a cookie POST from another origin or with no Origin, and accepts the same origin', async ({ playwright }) => {
    const request = await bare(playwright, demoOrigin);
    await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    const customer = { companyName: '' };
    expect((await request.post('/api/customers', { data: customer })).status()).toBe(403);
    expect((await request.post('/api/customers', { data: customer, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await request.post('/api/customers', { data: customer, headers: { origin: demoOrigin } })).status()).toBe(400);
    await request.dispose();
  });

  test('lets a bearer POST to /api/v1/* past the Origin check', async ({ playwright }) => {
    const request = await bare(playwright, demoOrigin);
    expect((await request.post('/api/v1/ping', { headers: { authorization: 'Bearer cbs_x_y' } })).status()).toBe(405);
    await request.dispose();
  });
});

test.describe('authelia mode', () => {
  const signedIn = { 'x-cbs-proxy-secret': proxySecret, 'remote-user': 'alice', 'remote-groups': memberGroup, 'remote-email': 'alice@example.test', 'remote-name': 'Alice A' };
  let request: APIRequestContext;

  test.beforeEach(async ({ playwright }) => { request = await bare(playwright, autheliaOrigin); });
  test.afterEach(async () => { await request.dispose(); });

  test('rejects every request that lacks the proxy secret, whatever identity it forges', async () => {
    const forged = { 'remote-user': 'admin', 'remote-groups': superadminGroup };
    for (const path of ['/', '/dashboard', '/api/auth/me', '/api/tenants', '/api/v1/ping']) {
      expect((await request.get(path)).status(), `${path} with no headers`).toBe(401);
      expect((await request.get(path, { headers: forged })).status(), `${path} with forged identity`).toBe(401);
    }
    expect((await request.get('/api/auth/me', { headers: { ...signedIn, 'x-cbs-proxy-secret': 'x'.repeat(proxySecret.length) } })).status()).toBe(401);
    expect((await request.get('/api/auth/me', { headers: { ...signedIn, 'x-cbs-proxy-secret': 'short' } })).status()).toBe(401);
  });

  test('still answers the health check without a secret', async () => {
    expect((await request.get('/api/health')).status()).toBe(200);
  });

  test('accepts a request with the secret and resolves the forwarded identity', async () => {
    const member = await request.get('/api/auth/me', { headers: signedIn });
    expect(member.status()).toBe(200);
    expect(await member.json()).toEqual({ principal: 'member', identity: { username: 'alice', email: 'alice@example.test', name: 'Alice A', groups: [memberGroup] } });
    const platform = await request.get('/api/auth/me', { headers: { ...signedIn, 'remote-user': 'root', 'remote-groups': `${memberGroup}, ${superadminGroup}` } });
    expect(await platform.json()).toMatchObject({ principal: 'platform', identity: { username: 'root' } });
  });

  test('refuses a signed-in user outside the allowed groups, or with an empty username', async () => {
    expect((await request.get('/api/auth/me', { headers: { ...signedIn, 'remote-groups': 'cwerp-users' } })).status()).toBe(403);
    expect((await request.get('/api/auth/me', { headers: { ...signedIn, 'remote-user': '' } })).status()).toBe(401);
  });

  test('has no demo login or identity picker, even for a request with the secret', async () => {
    expect((await request.post('/api/auth/demo-login', { data: { userId: 'superadmin' }, headers: { ...signedIn, origin: autheliaOrigin } })).status()).toBe(404);
    expect((await request.get('/api/auth/identities', { headers: signedIn })).status()).toBe(404);
    expect((await request.post('/api/auth/login', { data: { userId: 'superadmin' }, headers: { ...signedIn, origin: autheliaOrigin } })).status()).toBe(404);
  });

  test('gives the demo cookie no authority', async () => {
    const headers = { ...signedIn, cookie: `${sessionCookie}=superadmin`, 'remote-groups': memberGroup };
    expect((await request.get('/api/tenants', { headers })).status()).toBe(401);
    expect((await request.get('/api/customers', { headers })).status()).toBe(401);
  });

  test('checks Origin on every POST', async () => {
    expect((await request.post('/api/customers', { data: { companyName: '' }, headers: signedIn })).status()).toBe(403);
    expect((await request.post('/api/customers', { data: { companyName: '' }, headers: { ...signedIn, origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await request.post('/api/customers', { data: { companyName: '' }, headers: { ...signedIn, origin: autheliaOrigin } })).status()).toBe(401);
  });

  test('never lets a forged Remote-User reach /api/v1/*', async () => {
    const response = await request.get('/api/v1/ping', { headers: { ...signedIn, authorization: 'Bearer cbs_x_y' } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, remoteUser: null });
  });

  test.describe('in a browser behind the proxy', () => {
    test.use({ baseURL: autheliaOrigin, extraHTTPHeaders: signedIn });

    test('shows a signed-in user who has no tenant access yet, and not the demo picker', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'No billing access yet' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Choose a demo identity' })).toHaveCount(0);
    });
  });
});
