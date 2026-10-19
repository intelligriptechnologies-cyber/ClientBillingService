import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseForTest, DATABASE_TESTS_SKIP_REASON } from '@/lib/db/test-database';
import { createPgStore } from '@/lib/store/pg/create-pg-store';
import { memberContext, storeForTest } from '@/lib/store/test-store';
import type { TenantStore } from '@/lib/tenant-store';
import * as customers from '../../app/api/customers/route';
import * as selectTenant from '../../app/api/auth/select-tenant/route';
import * as tenants from '../../app/api/tenants/route';
import { parseAuthConfig, type AuthConfig } from './config';
import { demoCookie, resolvePrincipal, tenantCookie } from './resolve';

const world = vi.hoisted(() => ({ store: undefined as unknown }));

vi.mock('@/lib/operational-error', () => ({ recordOperationException: () => undefined }));
vi.mock('@/lib/tenant-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-store')>()),
  getTenantStore: () => world.store,
}));

const secret = 'p'.repeat(32);
const autheliaEnv = {
  CLIENT_BILLING_AUTH_MODE: 'authelia',
  CBS_PROXY_SECRET: secret,
  CBS_AUTH_MEMBER_GROUP: 'cbs-users',
  CBS_AUTH_SUPERADMIN_GROUP: 'cbs-superadmin',
  CBS_AUTHELIA_LOGOUT_URL: 'https://auth.example.test/logout',
};

function configFrom(env: Record<string, string>): AuthConfig {
  const result = parseAuthConfig(env);
  if (!result.ok) throw new Error(result.reason);
  return result.config;
}

const authelia = configFrom(autheliaEnv);
const demo = configFrom({});

type Arrival = { username: string; email?: string; groups?: string; secret?: string | null; cookies?: Record<string, string> };

function headersFor(arrival: Arrival) {
  const headers = new Headers({ 'remote-user': arrival.username, 'remote-groups': arrival.groups ?? 'cbs-users', 'remote-email': arrival.email ?? '', 'remote-name': arrival.username });
  if (arrival.secret !== null) headers.set('x-cbs-proxy-secret', arrival.secret ?? secret);
  if (arrival.cookies) headers.set('cookie', Object.entries(arrival.cookies).map(([name, value]) => `${name}=${value}`).join('; '));
  return headers;
}

const arrive = (store: TenantStore, arrival: Arrival) => resolvePrincipal(authelia, { headers: headersFor(arrival) }, store);
const demoRequest = (cookies: Record<string, string>) => ({ headers: new Headers(Object.keys(cookies).length ? { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ') } : {}) });

/** A person nobody has seen yet: a fresh Authelia username and an email no seeded row uses. */
function newPerson(label: string) {
  const suffix = randomUUID().slice(0, 8);
  return { username: `a7-${label}-${suffix}`, email: `${label}-${suffix}@a7.example` };
}

async function addUser(store: TenantStore, adminId: string, email: string, role: 'admin' | 'user' = 'user') {
  return store.createTenantUser(await memberContext(store, adminId), { name: `Added ${email}`, email, role });
}

async function bindingLogs(store: TenantStore, adminId: string, username: string) {
  return (await store.listOperationalLogs(await memberContext(store, adminId))).filter((log) => log.message.includes(username));
}

/** Fails the test if the resolver reads the store at all. */
const untouchable = new Proxy({}, { get: (_target, name) => { throw new Error(`The resolver read the store (${String(name)}) for a request it should have refused.`); } }) as TenantStore;

function stubEnv(values: Record<string, string>) {
  for (const key of ['CLIENT_BILLING_ENV', 'CLIENT_BILLING_AUTH_MODE']) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('getPrincipal in authelia mode, before any store read', () => {
  it.each([
    ['no secret', null],
    ['a same-length wrong secret', 'q'.repeat(32)],
    ['a short secret', 'short'],
  ])('resolves a forged Remote-User with %s to nothing', async (_label, presented) => {
    expect(await arrive(untouchable, { username: 'mallory', groups: 'cbs-superadmin', email: 'Admin@nexio.com', secret: presented })).toBeNull();
    expect(await arrive(untouchable, { username: 'nexio-admin', secret: presented })).toBeNull();
  });

  it('resolves the superadmin group to the platform principal from the group alone', async () => {
    expect(await arrive(untouchable, { username: 'root', email: 'root@a7.example', groups: 'cbs-users, cbs-superadmin' })).toEqual({ kind: 'platform', actor: { kind: 'platform', username: 'root' }, viewer: { name: 'root', email: 'root@a7.example' } });
  });

  it('refuses a person outside the allowed groups without binding anything', async () => {
    expect(await arrive(untouchable, { username: 'cwerp-user', email: 'Admin@nexio.com', groups: 'cwerp-users' })).toEqual({ kind: 'noAccess' });
  });

  it('never reads the demo cookie', async () => {
    expect(await resolvePrincipal(authelia, { headers: new Headers({ cookie: `${demoCookie}=platform` }) }, untouchable)).toBeNull();
  });
});

// Users.authelia_username exists only in the Postgres schema, and so does one email in two tenants: the legacy
// SQLite store serves demo mode alone. These run whenever a database is configured, under either TEST_DRIVER.
describe.skipIf(!process.env.DATABASE_MIGRATE_URL)(`getPrincipal in authelia mode, on Postgres (${DATABASE_TESTS_SKIP_REASON})`, () => {
  let store: TenantStore;
  let drop: () => Promise<void>;
  beforeEach(async () => { const database = await databaseForTest(); store = createPgStore(database.db); drop = database.drop; world.store = store; });
  afterEach(async () => { await drop(); });

  it('gives a person with one active row that tenant, with no chooser', async () => {
    const person = newPerson('one');
    const row = await addUser(store, 'nexio-admin', person.email);
    expect(await arrive(store, person)).toEqual({
      kind: 'member',
      context: { tenantId: 'nexio', actor: { kind: 'user', id: row.id, username: person.username } },
      role: 'user',
      viewer: { name: person.username, email: person.email },
      tenantIds: ['nexio'],
    });
  });

  it('binds on first arrival once, and writes one log row for the binding', async () => {
    const person = newPerson('once');
    await addUser(store, 'nexio-admin', person.email.toUpperCase());
    expect(await bindingLogs(store, 'nexio-admin', person.username)).toHaveLength(0);
    for (let visit = 0; visit < 3; visit += 1) expect((await arrive(store, person))?.kind).toBe('member');
    expect(await bindingLogs(store, 'nexio-admin', person.username)).toHaveLength(1);
  });

  it('returns only tenant_id, id, role and status from the sign-in lookups', async () => {
    const person = newPerson('columns');
    await addUser(store, 'nexio-admin', person.email);
    const bound = await store.bindMemberships(person.username, person.email);
    const listed = await store.listMemberships(person.username);
    for (const rows of [bound, listed]) {
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(['id', 'role', 'status', 'tenantId']);
    }
    expect(await store.bindMemberships(person.username, person.email)).toEqual([]);
  });

  it('binds nothing for a later arrival with the same email under a different username', async () => {
    const person = newPerson('claimed');
    await addUser(store, 'nexio-admin', person.email);
    expect((await arrive(store, person))?.kind).toBe('member');
    const impostor = { username: `${person.username}-2`, email: person.email };
    expect(await arrive(store, impostor)).toEqual({ kind: 'noAccess' });
    expect(await store.listMemberships(impostor.username)).toEqual([]);
    expect((await arrive(store, person))?.kind).toBe('member');
  });

  it('refuses a disabled user on the next request', async () => {
    const person = newPerson('disabled');
    const row = await addUser(store, 'nexio-admin', person.email);
    expect((await arrive(store, person))?.kind).toBe('member');
    await store.updateTenantUser(await memberContext(store, 'nexio-admin'), row.id, { status: 'disabled' });
    expect(await arrive(store, person)).toEqual({ kind: 'noAccess' });
  });

  it('never binds a person outside the allowed groups, and refuses them', async () => {
    const person = newPerson('outsider');
    await addUser(store, 'nexio-admin', person.email);
    expect(await arrive(store, { ...person, groups: 'cwerp-users' })).toEqual({ kind: 'noAccess' });
    expect(await store.listMemberships(person.username)).toEqual([]);
    expect(await bindingLogs(store, 'nexio-admin', person.username)).toHaveLength(0);
  });

  it('binds nothing when Authelia forwards no email', async () => {
    const person = newPerson('no-email');
    await addUser(store, 'nexio-admin', person.email);
    expect(await arrive(store, { username: person.username })).toEqual({ kind: 'noAccess' });
    expect(await store.listMemberships(person.username)).toEqual([]);
  });

  it('resolves the superadmin group to the platform principal from the group alone, even with a matching row', async () => {
    const person = newPerson('root');
    await addUser(store, 'nexio-admin', person.email);
    expect(await arrive(store, { ...person, groups: 'cbs-users, cbs-superadmin' })).toEqual({ kind: 'platform', actor: { kind: 'platform', username: person.username }, viewer: { name: person.username, email: person.email } });
    expect(await store.listMemberships(person.username)).toEqual([]);
  });

  it('keeps the superadmin out of tenant routes and lets it into platform routes', async () => {
    stubEnv(autheliaEnv);
    const headers = headersFor({ username: 'root', groups: 'cbs-superadmin' });
    expect((await customers.GET(new Request('http://localhost/api/customers', { headers }))).status).toBe(401);
    expect((await tenants.GET(new Request('http://localhost/api/tenants', { headers }))).status).toBe(200);
    const member = headersFor({ username: 'nexio-admin', email: 'Admin@nexio.com' });
    expect((await tenants.GET(new Request('http://localhost/api/tenants', { headers: member }))).status).toBe(403);
  });
});

describe('getPrincipal in demo mode', () => {
  let store: TenantStore;
  beforeEach(async () => { store = await storeForTest(); world.store = store; });

  it('resolves no cookie to nothing', async () => {
    expect(await resolvePrincipal(demo, demoRequest({}), store)).toBeNull();
  });

  it('resolves the picker superadmin entry to the platform principal, with no users row', async () => {
    expect(await resolvePrincipal(demo, demoRequest({ [demoCookie]: 'platform' }), store)).toMatchObject({ kind: 'platform', actor: { kind: 'platform' } });
  });

  it('resolves a member id to its tenant and ignores a forged tenant cookie', async () => {
    const principal = await resolvePrincipal(demo, demoRequest({ [demoCookie]: 'nexio-admin', [tenantCookie]: 'evo' }), store);
    expect(principal).toMatchObject({ kind: 'member', context: { tenantId: 'nexio', actor: { kind: 'user', id: 'nexio-admin' } }, role: 'admin', tenantIds: ['nexio'] });
  });

  it('refuses a disabled member and an unknown id', async () => {
    await store.updateTenantUser(await memberContext(store, 'nexio-admin'), 'nexio-user', { status: 'disabled' });
    expect(await resolvePrincipal(demo, demoRequest({ [demoCookie]: 'nexio-user' }), store)).toEqual({ kind: 'noAccess' });
    expect(await resolvePrincipal(demo, demoRequest({ [demoCookie]: 'no-such-user' }), store)).toEqual({ kind: 'noAccess' });
  });
});

// Users.email is globally unique in the legacy SQLite schema, so one email in two tenants exists only on Postgres.
describe.skipIf(!process.env.DATABASE_MIGRATE_URL)(`one person in several tenants, on Postgres (${DATABASE_TESTS_SKIP_REASON})`, () => {
  let store: TenantStore;
  let drop: () => Promise<void>;
  beforeEach(async () => { const database = await databaseForTest(); store = createPgStore(database.db); drop = database.drop; world.store = store; });
  afterEach(async () => { await drop(); });

  async function inBothTenants(label: string) {
    const person = newPerson(label);
    const nexio = await addUser(store, 'nexio-admin', person.email);
    const evo = await addUser(store, 'evo-admin', person.email, 'admin');
    return { person, nexio, evo };
  }

  /** Opens two pooled platform connections, so two racing arrivals start together instead of one waiting on connection setup. */
  const warmPool = () => Promise.all([store.listMemberships('warm-a'), store.listMemberships('warm-b')]);

  const choose = (arrival: Arrival, tenantId: string) => {
    stubEnv(autheliaEnv);
    const headers = headersFor(arrival);
    headers.set('content-type', 'application/json');
    return selectTenant.POST(new Request('http://localhost/api/auth/select-tenant', { method: 'POST', headers, body: JSON.stringify({ tenantId }) }));
  };

  it('asks a person whose email matches several tenants to choose, and never guesses', async () => {
    const { person } = await inBothTenants('several');
    expect(await arrive(store, person)).toEqual({ kind: 'chooseTenant', tenantIds: ['evo', 'nexio'], viewer: { name: person.username, email: person.email } });
    expect(await bindingLogs(store, 'nexio-admin', person.username)).toHaveLength(1);
    expect(await bindingLogs(store, 'evo-admin', person.username)).toHaveLength(1);
  });

  it('sets the tenant cookie on a choice, and sends a forged tenant cookie back to the chooser', async () => {
    const { person, evo } = await inBothTenants('choice');
    await arrive(store, person);
    const chosen = await choose(person, 'evo');
    expect(chosen.status).toBe(200);
    expect(chosen.headers.get('set-cookie')).toMatch(new RegExp(`^${tenantCookie}=evo;.*Path=/.*Secure`, 'i'));
    expect(await arrive(store, { ...person, cookies: { [tenantCookie]: 'evo' } })).toMatchObject({ kind: 'member', context: { tenantId: 'evo', actor: { id: evo.id } }, role: 'admin', tenantIds: ['evo', 'nexio'] });
    expect(await arrive(store, { ...person, cookies: { [tenantCookie]: 'maasp' } })).toMatchObject({ kind: 'chooseTenant' });
  });

  it('refuses a user bound to one tenant who selects another, exactly as it refuses a tenant that does not exist', async () => {
    const person = newPerson('bound-to-a');
    await addUser(store, 'nexio-admin', person.email);
    await arrive(store, person);
    const other = await choose(person, 'evo');
    const missing = await choose(person, 'no-such-tenant');
    expect(other.status).toBe(400);
    expect(other.headers.get('set-cookie')).toBeNull();
    expect({ status: missing.status, body: await missing.text() }).toEqual({ status: other.status, body: await other.text() });
    expect(await arrive(store, { ...person, cookies: { [tenantCookie]: 'evo' } })).toMatchObject({ kind: 'member', context: { tenantId: 'nexio' } });
  });

  it('gives demo mode the same outcomes for one email in two tenants', async () => {
    const { nexio } = await inBothTenants('demo-two');
    const pick = (tenantId?: string) => resolvePrincipal(demo, demoRequest({ [demoCookie]: nexio.id, ...(tenantId ? { [tenantCookie]: tenantId } : {}) }), store);
    expect(await pick()).toMatchObject({ kind: 'member', context: { tenantId: 'nexio' }, tenantIds: ['evo', 'nexio'] });
    expect(await pick('evo')).toMatchObject({ kind: 'member', context: { tenantId: 'evo' }, role: 'admin' });
    expect(await pick('maasp')).toMatchObject({ kind: 'chooseTenant', tenantIds: ['evo', 'nexio'] });
  });

  it('drops a tenant whose row is disabled on the next request and keeps the other', async () => {
    const { person, evo } = await inBothTenants('one-disabled');
    await arrive(store, person);
    await store.updateTenantUser(await memberContext(store, 'evo-admin'), evo.id, { status: 'disabled' });
    expect(await arrive(store, { ...person, cookies: { [tenantCookie]: 'evo' } })).toMatchObject({ kind: 'member', context: { tenantId: 'nexio' }, tenantIds: ['nexio'] });
  });

  it('binds once when two first arrivals of one person race', async () => {
    const { person } = await inBothTenants('race');
    await warmPool();
    const outcomes = await Promise.all([arrive(store, person), arrive(store, person)]);
    expect(outcomes.map((outcome) => outcome?.kind)).toEqual(['chooseTenant', 'chooseTenant']);
    expect(await bindingLogs(store, 'nexio-admin', person.username)).toHaveLength(1);
    expect(await bindingLogs(store, 'evo-admin', person.username)).toHaveLength(1);
  });

  it('lets exactly one of two usernames racing for one email bind, and binds all of its rows', async () => {
    const { person } = await inBothTenants('contest');
    const rival = { username: `${person.username}-rival`, email: person.email };
    await warmPool();
    const outcomes = await Promise.all([arrive(store, person), arrive(store, rival)]);
    const owners = [(await store.listMemberships(person.username)).length, (await store.listMemberships(rival.username)).length];
    expect(owners.sort()).toEqual([0, 2]);
    expect(outcomes.map((outcome) => outcome?.kind).sort()).toEqual(['chooseTenant', 'noAccess']);
  });
});
