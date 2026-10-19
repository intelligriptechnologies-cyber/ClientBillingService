import { getTenantStore, type DemoIdentity, type TenantStore } from '../tenant-store';
import { readAuthConfig, type AuthConfig, type AutheliaAuthConfig } from './config';
import { DEMO_SUPERADMIN } from './demo-identities';
import { parseForwardedIdentity } from './forwarded';
import type { Membership, MemberRole, Resolution, Viewer } from './principal';

/** Demo mode's identity: a users.id, or `demoPlatform` for the picker's superadmin entry (ADR 0002, decision 13). */
export const demoCookie = '__Host-cbs_demo';
/** The selected tenant id. Not a credential: it counts only when one of the person's active rows backs it. */
export const tenantCookie = '__Host-cbs_tenant';
export const demoPlatform = 'platform';
/** `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a sibling subdomain cannot set these cookies. */
export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export type PrincipalRequest = { headers: Headers };

function readCookie(headers: Headers, name: string): string | undefined {
  for (const pair of (headers.get('cookie') ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return undefined;
}

/** One active row selects itself. With more, only an active row for the selected tenant does, so a forged cookie at most reopens the chooser. */
export function selectMembership(memberships: readonly Membership[], selectedTenantId: string | undefined, viewer: Viewer, username: string | null): Resolution {
  const active = memberships.filter((membership) => membership.status === 'active');
  if (active.length === 0) return { kind: 'noAccess' };
  const tenantIds = active.map((membership) => membership.tenantId).sort();
  const chosen = active.length === 1 ? active[0] : active.find((membership) => membership.tenantId === selectedTenantId);
  if (!chosen) return { kind: 'chooseTenant', tenantIds, viewer };
  return { kind: 'member', context: { tenantId: chosen.tenantId, actor: { kind: 'user', id: chosen.id, username } }, role: chosen.role, viewer, tenantIds };
}

/** Binds on every arrival rather than only the first, so a row added later for the same email binds on the next request. */
async function resolveForwarded(config: AutheliaAuthConfig, headers: Headers, store: TenantStore): Promise<Resolution | null> {
  const forwarded = parseForwardedIdentity(headers, config);
  if (!forwarded.ok) return forwarded.status === 401 ? null : { kind: 'noAccess' };
  const { username, email, name } = forwarded.identity;
  const viewer = { name, email };
  if (forwarded.access === 'platform') return { kind: 'platform', actor: { kind: 'platform', username }, viewer };
  await store.bindMemberships(username, email);
  return selectMembership(await store.listMemberships(username), readCookie(headers, tenantCookie), viewer, username);
}

/** A demo person is every active row sharing the picked row's email, so one email in two tenants reaches the chooser here too. */
async function resolveDemo(headers: Headers, store: TenantStore): Promise<Resolution | null> {
  const picked = readCookie(headers, demoCookie);
  if (!picked) return null;
  if (picked === demoPlatform) return { kind: 'platform', actor: { kind: 'platform', username: DEMO_SUPERADMIN.id }, viewer: { name: DEMO_SUPERADMIN.name, email: DEMO_SUPERADMIN.email } };
  const members = (await store.listIdentities()).filter((identity): identity is DemoIdentity & { role: MemberRole; tenantId: string } => identity.role !== 'superadmin' && identity.tenantId !== null);
  const identity = members.find((member) => member.id === picked);
  if (!identity) return { kind: 'noAccess' };
  const email = identity.email.toLowerCase();
  const memberships = members.filter((member) => member.email.toLowerCase() === email)
    .map((member): Membership => ({ tenantId: member.tenantId, id: member.id, role: member.role, status: 'active' }));
  return selectMembership(memberships, readCookie(headers, tenantCookie) ?? identity.tenantId, { name: identity.name, email: identity.email }, null);
}

export function resolvePrincipal(config: AuthConfig, request: PrincipalRequest, store: TenantStore): Promise<Resolution | null> {
  return config.mode === 'authelia' ? resolveForwarded(config, request.headers, store) : resolveDemo(request.headers, store);
}

/**
 * Who sent this request (ADR 0002, decision 4), read fresh each time so a disabled row loses access on its next
 * request. Null means nobody is signed in: no demo cookie, or forwarded headers without the proxy secret.
 */
export async function getPrincipal(request: PrincipalRequest): Promise<Resolution | null> {
  const result = readAuthConfig();
  return result.ok ? resolvePrincipal(result.config, request, getTenantStore()) : null;
}
