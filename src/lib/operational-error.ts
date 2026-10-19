import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getTenantStore } from './tenant-store';
import type { Resolution } from './auth/principal';
import { actorId } from './store/shared';

const logPath = join(process.cwd(), '.data', 'operational-errors.ndjson');

function who(principal: Resolution | null) {
  if (principal?.kind === 'member') return { tenantId: principal.context.tenantId, userId: actorId(principal.context) };
  if (principal?.kind === 'platform') return { tenantId: null, userId: principal.actor.username };
  return { tenantId: null, userId: null };
}

/** Persist caught operation errors without replacing the response with a logging failure. */
export async function recordOperationException(principal: Resolution | null, operation: string, cause: unknown): Promise<void> {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const entry = { at: new Date().toISOString(), ...who(principal), operation, name: error.name, message: error.message, stack: error.stack };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (loggingError) {
    console.error('Unable to write operation error log', loggingError);
  }
  if (principal?.kind === 'member') {
    try { await getTenantStore().recordOperationalError(principal.context, operation, error); }
    catch (loggingError) { console.error('Unable to write tenant error log', loggingError); }
  }
}
