import type { AppSession } from '../store/types';
import type { PlatformActor, TenantContext } from './principal';

// The bridge from today's demo session to the principals of ADR 0002 until unit A7 replaces getCurrentSession
// with getPrincipal. Each throws inside a route's existing try, with a message the route maps to 403.

/** The user of a tenant session, acting inside that tenant. */
export function tenantContextOf(session: AppSession): TenantContext {
  if (!session.tenantId || session.role === 'superadmin') throw new Error('Choose a tenant session. Only a tenant admin or user works inside a tenant.');
  return { tenantId: session.tenantId, actor: { kind: 'user', id: session.id, username: null } };
}

/** The superadmin, acting on the platform. */
export function platformActorOf(session: AppSession): PlatformActor {
  if (session.role !== 'superadmin') throw new Error('Only a superadmin may manage tenants.');
  return { kind: 'platform', username: session.id };
}
