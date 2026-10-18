import type { Database } from '../../db/database';
import { createPgCustomerMethods } from './customers';
import { createPgQuotationMethods } from './quotations';
import { createPgServiceMethods } from './services';
import { createPgSettingsMethods } from './settings';
import { createPgTenantMethods } from './tenants';

/**
 * The Postgres store (ADR 0001). It holds the areas ported so far: tenants, users and settings (D5), and services, customers and quotations (D6). The app keeps
 * the SQLite store until D11 switches it; until then only the store tests reach this one, under TEST_DRIVER=pg.
 */
export function createPgStore(db: Database) {
  return {
    ...createPgTenantMethods(db),
    ...createPgSettingsMethods(db),
    ...createPgServiceMethods(db),
    ...createPgCustomerMethods(db),
    ...createPgQuotationMethods(db),
    close: () => db.end(),
  };
}
