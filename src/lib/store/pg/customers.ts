import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseCustomerRow } from '../rows';
import { customerFields, monthRange } from '../rules';
import { now } from '../shared';
import type { CustomerInput, CustomerQuery, CustomerRecord, CustomerStatus, TenantStore } from '../types';

type Row = Record<string, unknown>;

/** undefined leaves the customer's default alone, null or blank clears it, anything else must be one of the tenant's own formats. */
async function formatDefault(tx: Tx, tenantId: string, input: CustomerInput): Promise<string | null | undefined> {
  if (input.invoiceFormatId === undefined) return undefined;
  if (!input.invoiceFormatId) return null;
  const { rows } = await tx.query('SELECT 1 FROM invoice_formats WHERE id = $1 AND tenant_id = $2', [input.invoiceFormatId, tenantId]);
  if (!rows[0]) throw new Error('The selected invoice format was not found.');
  return input.invoiceFormatId;
}

export async function findCustomer(tx: Tx, tenantId: string, customerId: string): Promise<CustomerRecord | null> {
  const { rows } = await tx.query<Row>('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [customerId, tenantId]);
  return rows[0] ? parseCustomerRow(rows[0]) : null;
}

export function createPgCustomerMethods(db: Database) {
  return {
    async listCustomers(context: TenantContext, query: CustomerQuery = {}) {
      const conditions = ['tenant_id = $1'];
      const values: unknown[] = [context.tenantId];
      const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
      const search = query.search?.trim().toLowerCase() ?? '';
      if (search) where((p) => `(lower(company_name) LIKE ${p} ESCAPE '' OR lower(contact_name) LIKE ${p} ESCAPE '' OR lower(email) LIKE ${p} ESCAPE '')`, `%${search}%`);
      if (query.status) where((p) => `status = ${p}`, query.status);
      if (query.invoiceDelivery) where((p) => `invoice_delivery = ${p}`, query.invoiceDelivery);
      if (query.month) {
        const range = monthRange(query.month);
        if (!range) conditions.push('false');
        else { where((p) => `created_at >= ${p}`, range.start); where((p) => `created_at < ${p}`, range.end); }
      }
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const clause = conditions.join(' AND ');
      return db.withTenant(context.tenantId, async (tx) => {
        const total = Number((await tx.query<Row>(`SELECT count(*) AS count FROM customers WHERE ${clause}`, values)).rows[0].count);
        const { rows } = await tx.query<Row>(`SELECT * FROM customers WHERE ${clause} ORDER BY company_name COLLATE "C", id COLLATE "C" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return { items: rows.map(parseCustomerRow), total };
      });
    },
    async getCustomer(context: TenantContext, customerId: string): Promise<CustomerRecord | null> {
      return db.withTenant(context.tenantId, (tx) => findCustomer(tx, context.tenantId, customerId));
    },
    async createCustomer(context: TenantContext, input: CustomerInput): Promise<CustomerRecord> {
      const customer = customerFields(input);
      return db.withTenant(context.tenantId, async (tx) => {
        const formatId = (await formatDefault(tx, context.tenantId, input)) ?? null;
        const { rows } = await tx.query<Row>(
          `INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, state_code, billing_address, invoice_delivery, status, invoice_format_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $12) RETURNING *`,
          [`customer-${crypto.randomUUID()}`, context.tenantId, customer.companyName, customer.contactName, customer.email, customer.phone, customer.gstin, customer.stateCode, customer.billingAddress, customer.invoiceDelivery, formatId, now()],
        );
        return parseCustomerRow(rows[0]);
      });
    },
    /** A full replace in one UPDATE, so the last save wins whole; the format default changes only when the save names one. */
    async updateCustomer(context: TenantContext, customerId: string, input: CustomerInput): Promise<CustomerRecord> {
      const customer = customerFields(input);
      return db.withTenant(context.tenantId, async (tx) => {
        const formatId = await formatDefault(tx, context.tenantId, input);
        const { rows } = await tx.query<Row>(
          `UPDATE customers SET company_name = $1, contact_name = $2, email = $3, phone = $4, gstin = $5, state_code = $6, billing_address = $7, invoice_delivery = $8,
             invoice_format_id = CASE WHEN $9::boolean THEN $10 ELSE invoice_format_id END, updated_at = $11
           WHERE id = $12 AND tenant_id = $13 RETURNING *`,
          [customer.companyName, customer.contactName, customer.email, customer.phone, customer.gstin, customer.stateCode, customer.billingAddress, customer.invoiceDelivery, formatId !== undefined, formatId ?? null, now(), customerId, context.tenantId],
        );
        if (!rows[0]) throw new Error('Customer not found.');
        return parseCustomerRow(rows[0]);
      });
    },
    async setCustomerStatus(context: TenantContext, customerId: string, status: CustomerStatus): Promise<CustomerRecord> {
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>('UPDATE customers SET status = $1, updated_at = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *', [status, now(), customerId, context.tenantId]);
        if (!rows[0]) throw new Error('Customer not found.');
        return parseCustomerRow(rows[0]);
      });
    },
  } satisfies Partial<TenantStore>;
}
