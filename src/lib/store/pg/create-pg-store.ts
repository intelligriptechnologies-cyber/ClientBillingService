import type { Database } from '../../db/database';
import { createPgSettingsMethods } from './settings';
import { createPgTenantMethods } from './tenants';

/**
 * The Postgres store (ADR 0001). It holds the areas ported so far: tenants, users and settings (D5). The app keeps
 * the SQLite store until D11 switches it; until then only the store tests reach this one, under TEST_DRIVER=pg.
 */
export function createPgStore(db: Database) {
  return {
    ...createPgTenantMethods(db),
    ...createPgSettingsMethods(db),
    close: () => db.end(),
  };
}
