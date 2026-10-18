import type { AppSession, DemoIdentity, TenantStore } from '../store/types';

/**
 * The picker's superadmin entry. The superadmin is an Authelia group with no users row (ADR 0002, decisions 3 and
 * 13), so demo mode supplies it here instead of reading it from the store.
 */
export const DEMO_SUPERADMIN: AppSession = { id: 'superadmin', name: 'Demo Superadmin', email: 'superadmin@ledgerly.demo', role: 'superadmin', tenantId: null, tenantName: null };

/** The superadmin, then the store's active members. The legacy SQLite store still has a superadmin row, left out so the entry appears once. */
export async function listDemoIdentities(store: TenantStore): Promise<DemoIdentity[]> {
  return [DEMO_SUPERADMIN, ...(await store.listIdentities()).filter((identity) => identity.role !== 'superadmin')];
}

/** The session a demo identity id signs in as, or null for an id that is not an active member. */
export async function demoSession(store: TenantStore, userId: string): Promise<AppSession | null> {
  if (userId === DEMO_SUPERADMIN.id) return DEMO_SUPERADMIN;
  const session = await store.authenticate(userId);
  return session?.role === 'superadmin' ? null : session;
}
