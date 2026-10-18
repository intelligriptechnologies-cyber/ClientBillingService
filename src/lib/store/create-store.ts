import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seed } from './schema';
import { createTenantMethods } from './tenants';
import { createServiceMethods } from './services';
import { createQuotationMethods } from './quotations';
import { createCustomerMethods } from './customers';
import { createContractMethods } from './contracts';
import { createTaskNoteMethods } from './task-notes';
import { createAdditionalServiceMethods } from './additional-services';
import { createBulkInvoiceMethods } from './bulk-invoices';
import { createInvoiceMethods } from './invoices';
import { createPaymentMethods } from './payments';
import { createSettingsMethods } from './settings';
import { createDeliveryMethods } from './deliveries';
import { createInvoiceFormatMethods } from './invoice-formats';

export function createTenantStore(filename = process.env.CLIENT_BILLING_DATABASE ?? '.data/client-billing.sqlite') {
  mkdirSync(dirname(filename), { recursive: true });
  if (filename !== ':memory:' && !existsSync(filename) && process.env.CLIENT_BILLING_SEED_MODE !== 'demo') {
    copyFileSync(resolve('seed', 'initial-data.sqlite'), filename);
  }
  const database = new DatabaseSync(filename);
  seed(database);
  return {
    ...createTenantMethods(database),
    ...createServiceMethods(database),
    ...createQuotationMethods(database),
    ...createCustomerMethods(database),
    ...createContractMethods(database),
    ...createTaskNoteMethods(database),
    ...createAdditionalServiceMethods(database),
    ...createBulkInvoiceMethods(database),
    ...createInvoiceMethods(database),
    ...createPaymentMethods(database),
    ...createSettingsMethods(database),
    ...createDeliveryMethods(database),
    ...createInvoiceFormatMethods(database),
    close() { database.close(); },
  };
}

let sharedStore: ReturnType<typeof createTenantStore> | undefined;
export function getTenantStore() {
  sharedStore ??= createTenantStore();
  return sharedStore;
}
