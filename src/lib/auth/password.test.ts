import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from 'argon2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { passwordLogin, passwordIdentity, revokePasswordSession, sessionCookie, sessionSeconds, type PasswordUser } from './password';
import { resolvePrincipal } from './resolve';
import { parseAuthConfig, type PasswordAuthConfig } from './config';
import type { TenantStore } from '../tenant-store';
import { POST } from '../../app/api/auth/login/route';

const directory = mkdtempSync(join(tmpdir(), 'cbs-password-test-'));
const file = join(directory, 'users.json');
const secret = 'test-proxy-secret-'.repeat(3);
const config: PasswordAuthConfig = { mode: 'password', env: 'production', usersFile: file, publicOrigin: 'https://billing.example.test', proxySecret: secret };
let user: PasswordUser;
const save = (value = user) => writeFileSync(file, JSON.stringify([value]));
const headers = (token: string) => new Headers({ cookie: `${sessionCookie}=${token}` });
async function login(source: string, now = Date.now()) {
  const result = await passwordLogin(file, 'alice', 'correct-test-password', source, now);
  expect(result.status).toBe(200);
  if (result.status !== 200) throw new Error('Login failed.');
  return result.token;
}
beforeAll(async () => { user = { username: 'alice', email: 'alice@example.test', name: 'Alice', platform: false, disabled: false, passwordHash: await hash('correct-test-password') }; save(); });
afterAll(() => { rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('independent password authentication', () => {
  it('requires all security settings and HTTPS in production', () => {
    expect(parseAuthConfig({ CLIENT_BILLING_AUTH_MODE: 'password', CLIENT_BILLING_ENV: 'production' }).ok).toBe(false);
    expect(parseAuthConfig({ CLIENT_BILLING_AUTH_MODE: 'password', CLIENT_BILLING_ENV: 'production', CBS_PROXY_SECRET: secret, CBS_PASSWORD_USERS_FILE: file, CBS_PUBLIC_ORIGIN: config.publicOrigin }).ok).toBe(true);
  });
  it('rejects anonymous callers and forged identity/demo cookies', async () => {
    const store = new Proxy({}, { get: () => { throw new Error('Must not read data anonymously'); } }) as TenantStore;
    for (const input of [new Headers(), new Headers({ 'remote-user': 'alice', 'remote-groups': 'cbs-superadmin', 'x-cbs-proxy-secret': secret, cookie: '__Host-cbs_demo=platform; __Host-cbs_session=forged' })]) {
      expect(await resolvePrincipal(config, { headers: input }, store)).toBeNull();
    }
  });
  it('checks passwords and preserves member roles from fresh database lookups', async () => {
    expect((await passwordLogin(file, 'alice', 'wrong', 'wrong-password')).status).toBe(401);
    const token = await login('valid');
    const memberships = [{ tenantId: 'tenant-a', id: 'user-a', role: 'user', status: 'active' }];
    const store = { bindMemberships: vi.fn(), listMemberships: vi.fn(async () => memberships) } as unknown as TenantStore;
    expect(await resolvePrincipal(config, { headers: headers(token) }, store)).toMatchObject({ kind: 'member', role: 'user', context: { tenantId: 'tenant-a' } });
    memberships[0].status = 'disabled';
    expect(await resolvePrincipal(config, { headers: headers(token) }, store)).toEqual({ kind: 'noAccess' });
  });
  it('expires sessions and revokes them on logout', async () => {
    const now = Date.now(); const token = await login('expiry', now);
    expect(passwordIdentity(file, headers(token), now)?.username).toBe('alice');
    expect(passwordIdentity(file, headers(token), now + sessionSeconds * 1000)).toBeNull();
    const other = await login('logout'); revokePasswordSession(headers(other));
    expect(passwordIdentity(file, headers(other))).toBeNull();
  });
  it('revokes existing sessions when an account is disabled or its role changes', async () => {
    const token = await login('disable'); save({ ...user, disabled: true });
    expect(passwordIdentity(file, headers(token))).toBeNull();
    expect((await passwordLogin(file, 'alice', 'correct-test-password', 'disabled-login')).status).toBe(401);
    save(); const other = await login('role-change'); save({ ...user, platform: true });
    expect(passwordIdentity(file, headers(other))).toBeNull(); save();
  });
  it('throttles by account across source changes, without blocking a different account', async () => {
    for (let n = 0; n < 10; n++) expect((await passwordLogin(file, 'unknown', 'wrong', `source-${n}`)).status).toBe(401);
    expect((await passwordLogin(file, 'unknown', 'wrong', 'new-source')).status).toBe(429);
    expect((await passwordLogin(file, 'alice', 'correct-test-password', 'independent')).status).toBe(200);
  });
  it('requires the edge secret and same-origin login; returns a secure opaque cookie', async () => {
    for (const [key, value] of Object.entries({ CLIENT_BILLING_AUTH_MODE: 'password', CLIENT_BILLING_ENV: 'production', CBS_PASSWORD_USERS_FILE: file, CBS_PROXY_SECRET: secret, CBS_PUBLIC_ORIGIN: config.publicOrigin })) vi.stubEnv(key, value);
    const request = (h: Record<string, string>) => new Request(`${config.publicOrigin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ username: 'alice', password: 'correct-test-password' }) });
    expect((await POST(request({ origin: config.publicOrigin }))).status).toBe(401);
    expect((await POST(request({ 'x-cbs-proxy-secret': secret, origin: 'https://evil.test' }))).status).toBe(403);
    const response = await POST(request({ 'x-cbs-proxy-secret': secret, origin: config.publicOrigin }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=lax'); expect(cookie).not.toContain('Domain=');
    vi.unstubAllEnvs();
  });
});
