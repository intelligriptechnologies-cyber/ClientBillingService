import type { AppSession } from './types';

export function now() { return new Date().toISOString(); }
export function requireSuperadmin(session: AppSession) { if (session.role !== 'superadmin') throw new Error('Only a superadmin may manage tenants.'); }
export function requireTenantAdmin(session: AppSession, subject = 'users'): asserts session is AppSession & { tenantId: string; role: 'admin' } {
  if (!session.tenantId) throw new Error(`Only a tenant admin can manage ${subject}.`);
  if (session.role !== 'admin') throw new Error(`Only a tenant admin can manage ${subject}.`);
}
export function requireTenantMember(session: AppSession): asserts session is AppSession & { tenantId: string } {
  if (!session.tenantId || session.role === 'superadmin') throw new Error('Choose a tenant session to manage billing data.');
}
