import { expect, test, type APIRequestContext, type Browser, type Playwright } from '@playwright/test';
import { autheliaOrigin, demoOrigin, memberGroup, proxySecret, superadminGroup } from './test-ports';

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

  test('gives the demo and tenant cookies no authority', async () => {
    const headers = { ...signedIn, cookie: '__Host-cbs_demo=platform; __Host-cbs_tenant=nexio', 'remote-groups': memberGroup };
    expect((await request.get('/api/tenants', { headers })).status()).toBe(403);
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

  // Both e2e servers share cbs_e2e, so a tenant admin on the demo server adds the rows an Authelia arrival binds to.
  test.describe('memberships behind the proxy', () => {
    type Person = { username: string; email: string; headers: Record<string, string> };

    function newPerson(label: string, groups = memberGroup): Person {
      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const username = `a7-${label}-${suffix}`;
      const email = `${label}-${suffix}@a7.example`;
      return { username, email, headers: { 'x-cbs-proxy-secret': proxySecret, 'remote-user': username, 'remote-groups': groups, 'remote-email': email, 'remote-name': `A7 ${label}` } };
    }

    async function asDemoAdmin(playwright: Playwright, adminId: string) {
      const admin = await playwright.request.newContext({ baseURL: demoOrigin, extraHTTPHeaders: { origin: demoOrigin } });
      expect((await admin.post('/api/auth/demo-login', { data: { userId: adminId } })).status()).toBe(200);
      return admin;
    }

    async function addMember(playwright: Playwright, adminId: string, person: Person) {
      const admin = await asDemoAdmin(playwright, adminId);
      const created = await admin.post('/api/users', { data: { name: `A7 ${person.username}`, email: person.email, role: 'user' } });
      expect(created.status()).toBe(201);
      const { user } = await created.json() as { user: { id: string } };
      await admin.dispose();
      return user.id;
    }

    async function bindingLogs(playwright: Playwright, adminId: string, person: Person) {
      const admin = await asDemoAdmin(playwright, adminId);
      const { logs } = await (await admin.get('/api/logs')).json() as { logs: Array<{ message: string }> };
      await admin.dispose();
      return logs.filter((log) => log.message.includes(person.username) && log.message.startsWith('First arrival bound'));
    }

    async function browse(browser: Browser, person: Person) {
      const context = await browser.newContext({ baseURL: autheliaOrigin, extraHTTPHeaders: person.headers });
      return { context, page: await context.newPage() };
    }

    test('binds a first arrival once, asks a person in two tenants to choose, and switches tenant from the menu', async ({ browser, playwright }) => {
      const person = newPerson('two');
      await addMember(playwright, 'nexio-admin', person);
      await addMember(playwright, 'evo-admin', person);
      const { context, page } = await browse(browser, person);

      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/select-tenant$/);
      await expect(page.getByRole('heading', { name: 'Choose a tenant' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^(Evo Fitness|Nexio Hyper)$/ })).toHaveCount(2);
      await page.getByRole('button', { name: 'Nexio Hyper' }).click();
      await expect(page.getByRole('heading', { name: 'Nexio Hyper dashboard' })).toBeVisible();

      const switcher = page.getByRole('combobox', { name: 'Switch tenant' });
      await expect(switcher).toHaveValue('nexio');
      await switcher.selectOption('evo');
      await expect(page.getByRole('heading', { name: 'Evo Fitness dashboard' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Evo Fitness dashboard' })).toBeVisible();

      expect(await bindingLogs(playwright, 'nexio-admin', person)).toHaveLength(1);
      expect(await bindingLogs(playwright, 'evo-admin', person)).toHaveLength(1);
      await context.close();
    });

    test('keeps a user bound to one tenant out of another, with no switcher', async ({ browser, playwright }) => {
      const person = newPerson('one');
      await addMember(playwright, 'nexio-admin', person);
      const { context, page } = await browse(browser, person);

      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Nexio Hyper dashboard' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Switch tenant' })).toHaveCount(0);
      const select = (tenantId: string) => page.request.post('/api/auth/select-tenant', { data: { tenantId }, headers: { origin: autheliaOrigin } });
      const other = await select('evo');
      const missing = await select('no-such-tenant');
      expect(other.status()).toBe(400);
      expect(await other.text()).toBe(await missing.text());
      const forged = await page.request.get('/dashboard', { headers: { cookie: '__Host-cbs_tenant=evo' } });
      const html = await forged.text();
      expect(html).toContain('Nexio Hyper dashboard');
      expect(html).not.toContain('Evo Fitness');
      await context.close();
    });

    test('refuses a disabled user on the next request', async ({ browser, playwright }) => {
      const person = newPerson('disabled');
      const userId = await addMember(playwright, 'nexio-admin', person);
      const { context, page } = await browse(browser, person);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Nexio Hyper dashboard' })).toBeVisible();

      const admin = await asDemoAdmin(playwright, 'nexio-admin');
      expect((await admin.patch(`/api/users/${userId}`, { data: { status: 'disabled' } })).status()).toBe(200);
      await admin.dispose();

      await page.goto('/dashboard');
      await expect(page).toHaveURL(`${autheliaOrigin}/`);
      await expect(page.getByRole('heading', { name: 'No billing access yet' })).toBeVisible();
      expect((await page.request.get('/api/customers')).status()).toBe(401);
      await context.close();
    });

    test('signs out through the Authelia logout URL and clears the tenant choice', async ({ browser, playwright }) => {
      const person = newPerson('logout');
      await addMember(playwright, 'nexio-admin', person);
      await addMember(playwright, 'evo-admin', person);
      const { context, page } = await browse(browser, person);
      await page.route('https://auth.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Signed out of Authelia</h1>' }));

      await page.goto('/select-tenant');
      await page.getByRole('button', { name: 'Evo Fitness' }).click();
      await expect(page.getByRole('heading', { name: 'Evo Fitness dashboard' })).toBeVisible();
      expect((await context.cookies(autheliaOrigin)).map((cookie) => cookie.name)).toContain('__Host-cbs_tenant');

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL('https://auth.example.test/logout');
      await expect(page.getByRole('heading', { name: 'Signed out of Authelia' })).toBeVisible();
      expect((await context.cookies(autheliaOrigin)).map((cookie) => cookie.name)).not.toContain('__Host-cbs_tenant');
      await context.close();
    });

    test('gives the superadmin group the platform console from the group alone, and no tenant data', async ({ browser }) => {
      const person = newPerson('root', superadminGroup);
      const { context, page } = await browse(browser, person);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Platform dashboard' })).toBeVisible();
      await page.getByRole('link', { name: 'Tenants' }).click();
      await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
      expect((await page.request.get('/api/customers')).status()).toBe(401);
      await page.goto('/users');
      await expect(page).toHaveURL(/\/dashboard$/);
      await context.close();
    });
  });
});
