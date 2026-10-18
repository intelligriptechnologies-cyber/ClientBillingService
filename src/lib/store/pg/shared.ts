import { DatabaseError } from 'pg';
import type { TenantContext } from '../../auth/principal';
import type { Tx } from '../../db/database';

type Row = Record<string, unknown>;

/** SQLSTATE 23505, optionally on one of `constraints` (an index or constraint name). */
export function isUniqueViolation(error: unknown, constraints?: readonly string[]) {
  return error instanceof DatabaseError && error.code === '23505' && (!constraints || constraints.includes(error.constraint ?? ''));
}

/** Rethrows a unique violation on `constraints` as `message`, and anything else as it is. */
export function renameUniqueViolation(constraints: readonly string[], message: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error, constraints)) throw new Error(message);
    throw error;
  };
}

/** The acting user's role from its active users row, or null. Runs inside withTenant, so RLS limits it to the context's tenant. */
export async function actorRole(tx: Tx, context: TenantContext): Promise<string | null> {
  if (context.actor.kind !== 'user') return null;
  const { rows } = await tx.query<Row>(`SELECT role FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [context.actor.id, context.tenantId]);
  return rows[0] ? String(rows[0].role) : null;
}
