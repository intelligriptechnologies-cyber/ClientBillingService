export type Actor =
  | { kind: 'user'; id: string; username: string | null }
  | { kind: 'platform'; username: string }
  | { kind: 'apiToken'; id: string };

export type PlatformActor = Extract<Actor, { kind: 'platform' }>;

export type TenantContext = { tenantId: string; actor: Actor };

/** The four outcomes of resolving one request (ADR 0002, decision 4). */
export type Resolution =
  | { kind: 'platform'; actor: PlatformActor }
  | { kind: 'member'; context: TenantContext }
  | { kind: 'chooseTenant'; tenantIds: readonly string[] }
  | { kind: 'noAccess' };
