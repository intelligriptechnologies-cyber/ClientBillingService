export type Actor =
  | { kind: 'user'; id: string; username: string | null }
  | { kind: 'platform'; username: string }
  | { kind: 'apiToken'; id: string };

export type PlatformActor = Extract<Actor, { kind: 'platform' }>;

export type TenantContext = { tenantId: string; actor: Actor };

export type MemberRole = 'admin' | 'user';

/** One users row as the sign-in lookups return it: tenant_id, id, role and status, nothing else (ADR 0001, Consequences). */
export type Membership = { tenantId: string; id: string; role: MemberRole; status: 'active' | 'disabled' };

/** Who is signed in, for display only. Nothing is authorized from it. */
export type Viewer = { name: string; email: string };

/** The four outcomes of resolving one request (ADR 0002, decision 4). `tenantIds` lists every tenant the person may select. */
export type Resolution =
  | { kind: 'platform'; actor: PlatformActor; viewer: Viewer }
  | { kind: 'member'; context: TenantContext; role: MemberRole; viewer: Viewer; tenantIds: readonly string[] }
  | { kind: 'chooseTenant'; tenantIds: readonly string[]; viewer: Viewer }
  | { kind: 'noAccess' };

export type Member = Extract<Resolution, { kind: 'member' }>;

/** The tenant a member acts in. Throws inside a route's try, with a message the route maps to 403. */
export function tenantContextOf(principal: Resolution): TenantContext {
  if (principal.kind !== 'member') throw new Error('Choose a tenant session. Only a tenant admin or user works inside a tenant.');
  return principal.context;
}

/** The superadmin, acting on the platform. Throws inside a route's try, with a message the route maps to 403. */
export function platformActorOf(principal: Resolution): PlatformActor {
  if (principal.kind !== 'platform') throw new Error('Only a superadmin may manage tenants.');
  return principal.actor;
}
