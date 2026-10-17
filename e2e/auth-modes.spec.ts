import { expect, test, type Playwright } from '@playwright/test';
import { demoOrigin } from './test-ports';

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

  test('has no raw-user-id login route', async ({ playwright }) => {
    const request = await bare(playwright, demoOrigin);
    expect((await request.post('/api/auth/login', { data: { userId: 'superadmin' } })).status()).toBe(404);
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
    expect((await request.post('/api/v1/ping', { headers: { authorization: 'Bearer cbs_x_y' } })).status()).toBe(404);
    await request.dispose();
  });
});
