import type { Database } from '../../db/database';
import { createPgAdditionalServiceMethods } from './additional-services';
import { createPgContractMethods } from './contracts';
import { createPgCustomerMethods } from './customers';
import { createPgQuotationMethods } from './quotations';
import { createPgServiceMethods } from './services';
import { createPgSettingsMethods } from './settings';
import { createPgTaskNoteMethods } from './task-notes';
import { createPgTenantMethods } from './tenants';

/**
 * The Postgres store (ADR 0001). It holds the areas ported so far: tenants, users and settings (D5), services,
 * customers and quotations (D6), and contracts, deposits, task notes and additional services (D7). The app keeps the
 * SQLite store until D11 switches it; until then only the store tests reach this one, under TEST_DRIVER=pg.
 */
export function createPgStore(db: Database) {
  return {
    ...createPgTenantMethods(db),
    ...createPgSettingsMethods(db),
    ...createPgServiceMethods(db),
    ...createPgCustomerMethods(db),
    ...createPgQuotationMethods(db),
    ...createPgContractMethods(db),
    ...createPgTaskNoteMethods(db),
    ...createPgAdditionalServiceMethods(db),
    close: () => db.end(),
  };
}
