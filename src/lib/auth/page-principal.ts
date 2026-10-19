import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getTenantStore, type TenantName } from '../tenant-store';
import type { Member, PlatformActor, Resolution } from './principal';
import { getPrincipal } from './resolve';

/** The principal for this render. The layout and the page share one resolution, so binding and lookups run once per request. */
export const currentPrincipal = cache(async (): Promise<Resolution | null> => getPrincipal({ headers: await headers() }));

/** The tenants the person may select, by name. */
export const currentTenants = cache(async (): Promise<TenantName[]> => {
  const principal = await currentPrincipal();
  if (principal?.kind !== 'member' && principal?.kind !== 'chooseTenant') return [];
  return getTenantStore().listTenantNames(principal.tenantIds);
});

/** Sends anyone who is not signed in to a tenant to the page that fits them. */
function redirectUnlessSignedIn(principal: Resolution | null): asserts principal is Extract<Resolution, { kind: 'platform' | 'member' }> {
  if (!principal || principal.kind === 'noAccess') redirect('/');
  if (principal.kind === 'chooseTenant') redirect('/select-tenant');
}

/** The signed-in platform or member principal of an app page. */
export async function signedInPage() {
  const principal = await currentPrincipal();
  redirectUnlessSignedIn(principal);
  return principal;
}

/** The member a tenant page renders for, with its tenant's name. The superadmin, and a user on an admin page, go to the dashboard. */
export async function memberPage(options: { admin?: boolean } = {}): Promise<Member & { tenantName: string }> {
  const principal = await signedInPage();
  if (principal.kind !== 'member' || (options.admin && principal.role !== 'admin')) redirect('/dashboard');
  const tenantName = (await currentTenants()).find((tenant) => tenant.id === principal.context.tenantId)?.name ?? principal.context.tenantId;
  return { ...principal, tenantName };
}

/** The superadmin of a platform page. A member goes to the dashboard. */
export async function platformPage(): Promise<PlatformActor> {
  const principal = await signedInPage();
  if (principal.kind !== 'platform') redirect('/dashboard');
  return principal.actor;
}
