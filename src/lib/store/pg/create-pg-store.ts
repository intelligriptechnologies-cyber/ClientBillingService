import type { Database } from '../../db/database';
import type { TenantStore } from '../types';
import { createPgAdditionalServiceMethods } from './additional-services';
import { createPgBulkInvoiceMethods } from './bulk-invoices';
import { createPgContractMethods } from './contracts';
import { createPgCustomerMethods } from './customers';
import { createPgDeliveryMethods } from './deliveries';
import { createPgInvoiceFormatMethods } from './invoice-formats';
import { createPgInvoiceMethods } from './invoices';
import { createPgPaymentMethods } from './payments';
import { createPgQuotationMethods } from './quotations';
import { createPgServiceMethods } from './services';
import { createPgSettingsMethods } from './settings';
import { createPgTaskNoteMethods } from './task-notes';
import { createPgTenantMethods } from './tenants';

/**
 * The Postgres store (ADR 0001), with every area of the store contract: tenants, users and settings (D5), services,
 * customers and quotations (D6), contracts, deposits, task notes and additional services (D7), invoices with their
 * formats, delivery log, GST report and bulk runs (D8), and payments, reminders and pending-payment close (D9). The
 * app runs on it from D11 (getTenantStore in ../app-store.ts), and the store tests reach it under TEST_DRIVER=pg.
 */
export function createPgStore(db: Database): TenantStore {
  return {
    ...createPgTenantMethods(db),
    ...createPgSettingsMethods(db),
    ...createPgServiceMethods(db),
    ...createPgCustomerMethods(db),
    ...createPgQuotationMethods(db),
    ...createPgContractMethods(db),
    ...createPgTaskNoteMethods(db),
    ...createPgAdditionalServiceMethods(db),
    ...createPgInvoiceMethods(db),
    ...createPgInvoiceFormatMethods(db),
    ...createPgDeliveryMethods(db),
    ...createPgBulkInvoiceMethods(db),
    ...createPgPaymentMethods(db),
    close: () => db.end(),
  };
}
