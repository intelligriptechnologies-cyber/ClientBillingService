import { afterEach, describe } from 'vitest';
import { databaseForTest, DATABASE_TESTS_SKIP_REASON } from '../db/test-database';
import { createPgStore } from './pg/create-pg-store';
import type { TenantStore } from '../tenant-store';
import { tenantContextOf, type Member, type PlatformActor, type Resolution, type TenantContext } from '../auth/principal';
import { demoCookie, resolvePrincipal } from '../auth/resolve';

// Every storeForTest() call clones the seeded Postgres template, so tests stay independent of each other.

/** A describe block whose tests need a store. Without DATABASE_MIGRATE_URL it skips, and its name says why. */
export function describeStore(name: string, body: () => void) {
  if (process.env.DATABASE_MIGRATE_URL) return describe(name, body);
  describe.skip(`${name} (${DATABASE_TESTS_SKIP_REASON})`, body);
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A seeded store for one test, dropped after it. */
export async function storeForTest(): Promise<TenantStore> {
  const database = await databaseForTest();
  let dropped: Promise<void> | undefined;
  const close = () => (dropped ??= database.drop());
  cleanups.push(close);
  return { ...createPgStore(database.db), close };
}

/** The superadmin, built directly: it is an Authelia group with no users row (ADR 0002, decision 3). */
export const superadmin: PlatformActor = { kind: 'platform', username: 'superadmin' };

/** The member a demo sign-in as `userId` resolves to, through the real resolver, or null when that id is not an active member. */
export async function signIn(store: TenantStore, userId: string): Promise<Member | null> {
  const principal = await resolvePrincipal({ mode: 'demo', env: 'test' }, { headers: new Headers({ cookie: `${demoCookie}=${userId}` }) }, store);
  return principal?.kind === 'member' ? principal : null;
}

/** A seeded user acting inside its tenant. */
export async function memberContext(store: TenantStore, userId: string): Promise<TenantContext> {
  const member = await signIn(store, userId);
  if (!member) throw new Error(`Expected an active member for ${userId}.`);
  return member.context;
}

/** A seller with this GSTIN is registered in Karnataka. The demo sellers already are, with GSTINs of their own, so this changes the one a test depends on. */
export async function registerSeller(store: TenantStore, principal: Resolution) {
  await store.updateTenantSettings(tenantContextOf(principal), { ...await store.getTenantSettings(tenantContextOf(principal)), gstin: '29AAGCB7383J1Z4' });
}

/** The demo sellers are registered. A test about a seller with no GSTIN, which issues a Bill of Supply and may not charge GST, clears it first. */
export async function unregisterSeller(store: TenantStore, context: TenantContext) {
  await store.updateTenantSettings(context, { ...await store.getTenantSettings(context), gstin: '' });
}
