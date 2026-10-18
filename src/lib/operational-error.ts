import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getTenantStore, type AppSession } from './tenant-store';
import { tenantContextOf } from './auth/session-context';

const logPath = join(process.cwd(), '.data', 'operational-errors.ndjson');

/** Persist caught operation errors without replacing the response with a logging failure. */
export async function recordOperationException(session: AppSession | null, operation: string, cause: unknown): Promise<void> {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const entry = { at: new Date().toISOString(), tenantId: session?.tenantId ?? null, userId: session?.id ?? null, operation, name: error.name, message: error.message, stack: error.stack };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (loggingError) {
    console.error('Unable to write operation error log', loggingError);
  }
  if (session?.tenantId) {
    try { await getTenantStore().recordOperationalError(tenantContextOf(session), operation, error); }
    catch (loggingError) { console.error('Unable to write tenant error log', loggingError); }
  }
}
