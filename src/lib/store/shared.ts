import type { PlatformActor, TenantContext } from '../auth/principal';
import type { AppSession } from './types';

export function now() { return new Date().toISOString(); }
/** Who acted inside the tenant, as stored on rows that record it: a users.id, or an API token id. */
export function actorId(context: TenantContext) { return context.actor.kind === 'platform' ? context.actor.username : context.actor.id; }
/** The type already asks for the platform actor; this refuses a caller that slipped past it at runtime. */
export function requirePlatform(actor: PlatformActor) { if (actor?.kind !== 'platform') throw new Error('Only a superadmin may manage tenants.'); }
/** `role` is the acting user's role, read from its active users row in the context's tenant, or null. */
export function requireAdminRole(role: string | null, subject = 'users') { if (role !== 'admin') throw new Error(`Only a tenant admin can manage ${subject}.`); }
export function requireTenantAdmin(session: AppSession, subject = 'users'): asserts session is AppSession & { tenantId: string; role: 'admin' } {
  if (!session.tenantId) throw new Error(`Only a tenant admin can manage ${subject}.`);
  if (session.role !== 'admin') throw new Error(`Only a tenant admin can manage ${subject}.`);
}
export function requireTenantMember(session: AppSession): asserts session is AppSession & { tenantId: string } {
  if (!session.tenantId || session.role === 'superadmin') throw new Error('Choose a tenant session to manage billing data.');
}
