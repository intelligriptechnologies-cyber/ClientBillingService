import pg, { type PoolClient } from 'pg';
import { pgTypes } from './types';

/** A client inside one transaction. It offers only `query`, so callers cannot release it or keep it past the transaction. */
export type Tx = Pick<PoolClient, 'query'>;

export interface Database {
  /** Runs `fn` in a transaction as cbs_app with `app.tenant_id` set for that transaction only, so row-level security filters every table. */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs `fn` in a transaction as cbs_platform (BYPASSRLS): the superadmin console, sign-in lookups and jobs. */
  withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

async function inTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>, prepare?: (tx: Tx) => Promise<unknown>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    await prepare?.(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => { broken = rollbackError; });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** An idle client that loses its connection (a database restart, or a dropped test database) is logged and discarded; unhandled, the error would end the process. */
function pool(connectionString: string) {
  const created = new pg.Pool({ connectionString, types: pgTypes });
  created.on('error', (error) => console.error('An idle Postgres connection failed and was dropped from the pool.', error));
  return created;
}

export function createDatabase(urls: { app: string; platform: string }): Database {
  const app = pool(urls.app);
  const platform = pool(urls.platform);
  return {
    async withTenant(tenantId, fn) {
      if (!tenantId) throw new Error('withTenant needs a tenant id.');
      return inTransaction(app, fn, (tx) => tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]));
    },
    withPlatform: (fn) => inTransaction(platform, fn),
    async end() {
      await Promise.all([app.end(), platform.end()]);
    },
  };
}
