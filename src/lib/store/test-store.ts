import { afterEach, describe } from 'vitest';
import { databaseForTest } from '../db/test-database';
import { createPgStore } from './pg/create-pg-store';
import { createTenantStore, type AppSession, type TenantStore } from '../tenant-store';
import type { PlatformActor, TenantContext } from '../auth/principal';
import { tenantContextOf } from '../auth/session-context';

// The store tests run on one driver per run: TEST_DRIVER=sqlite (the default) or TEST_DRIVER=pg (ADR 0001, D4).
// Under pg every storeForTest() call clones the seeded template, so tests stay as independent as :memory: stores.

type Driver = 'sqlite' | 'pg';
type PortUnit = 'D5' | 'D6' | 'D7' | 'D8' | 'D9';

function driverFrom(value: string | undefined): Driver {
  if (!value || value === 'sqlite') return 'sqlite';
  if (value === 'pg') return 'pg';
  throw new Error(`TEST_DRIVER must be sqlite or pg, not ${value}.`);
}

export const testDriver = driverFrom(process.env.TEST_DRIVER);

/** The ADR 0001 unit that ports each store area to Postgres, and whether it has landed. */
const pgPorts = {
  tenants: { unit: 'D5', ported: true },
  users: { unit: 'D5', ported: true },
  settings: { unit: 'D5', ported: true },
  services: { unit: 'D6', ported: false },
  customers: { unit: 'D6', ported: false },
  quotations: { unit: 'D6', ported: false },
  contracts: { unit: 'D7', ported: false },
  deposits: { unit: 'D7', ported: false },
  taskNotes: { unit: 'D7', ported: false },
  additionalServices: { unit: 'D7', ported: false },
  invoices: { unit: 'D8', ported: false },
  bulkInvoices: { unit: 'D8', ported: false },
  payments: { unit: 'D9', ported: false },
  reminders: { unit: 'D9', ported: false },
} satisfies Record<string, { unit: PortUnit; ported: boolean }>;

export type StoreArea = keyof typeof pgPorts;

/** A describe block over the store areas its tests touch. Under pg it skips until every one of them has a port. */
export function describeStore(areas: StoreArea[], name: string, body: () => void) {
  const waiting = testDriver === 'pg' ? areas.filter((area) => !pgPorts[area].ported) : [];
  if (waiting.length === 0) return describe(name, body);
  const unit = waiting.map((area) => pgPorts[area].unit).sort().at(-1);
  describe.skip(`${name} (skipped under TEST_DRIVER=pg until ${unit} ports ${waiting.join(', ')})`, body);
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A store that answers every method it has, and rejects the rest by name instead of returning undefined. */
function withoutPort(ported: object): TenantStore {
  return new Proxy(ported, {
    get(target, name, receiver) {
      if (typeof name !== 'string' || name === 'then' || name in target) return Reflect.get(target, name, receiver);
      return () => Promise.reject(new Error(`${name} has no Postgres port yet.`));
    },
  }) as TenantStore;
}

/** A seeded store for one test, closed after it. */
export async function storeForTest(): Promise<TenantStore> {
  if (testDriver === 'sqlite') {
    const store = createTenantStore(':memory:');
    cleanups.push(async () => { await store.close(); });
    return store;
  }
  const database = await databaseForTest();
  let dropped: Promise<void> | undefined;
  const close = () => (dropped ??= database.drop());
  cleanups.push(close);
  return withoutPort({ ...createPgStore(database.db), close });
}

/** The superadmin, built directly: under Postgres it is an Authelia group with no users row (ADR 0002, decision 3). */
export const superadmin: PlatformActor = { kind: 'platform', username: 'superadmin' };

/** A seeded user acting inside its tenant. */
export async function memberContext(store: TenantStore, userId: string): Promise<TenantContext> {
  const session = await store.authenticate(userId);
  if (!session) throw new Error(`Expected an active session for ${userId}.`);
  return tenantContextOf(session);
}

/** The seeded sellers are unregistered and may not charge GST, so a test that bills GST registers its seller first. */
export async function registerSeller(store: TenantStore, session: AppSession) {
  await store.updateTenantSettings(tenantContextOf(session), { ...await store.getTenantSettings(tenantContextOf(session)), gstin: '29AAGCB7383J1Z4' });
}
