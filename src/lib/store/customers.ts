import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { existingFormatId } from './invoice-formats';
import { now } from './shared';
import { parseCustomerRow } from './rows';
import { customerFields } from './rules';
import type { CustomerStatus, CustomerRecord, CustomerInput, CustomerQuery } from './types';

type Row = Record<string, unknown>;

export function createCustomerMethods(database: DatabaseSync) {
  /** undefined leaves the customer's default alone, null or blank clears it, anything else must be one of the tenant's own formats. */
  function formatDefault(tenantId: string, input: CustomerInput): string | null | undefined {
    if (input.invoiceFormatId === undefined) return undefined;
    if (!input.invoiceFormatId) return null;
    const id = existingFormatId(database, tenantId, input.invoiceFormatId);
    if (!id) throw new Error('The selected invoice format was not found.');
    return id;
  }
  function find(tenantId: string, customerId: string): CustomerRecord | null {
    const row = database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId) as Row | undefined;
    return row ? parseCustomerRow(row) : null;
  }
  return {
    listCustomers(context: TenantContext, query: CustomerQuery = {}) {
      const search = query.search?.trim().toLowerCase() ?? ''; const filters = ['tenant_id = ?']; const values: (string | number)[] = [context.tenantId];
      if (search) { filters.push('(lower(company_name) LIKE ? OR lower(contact_name) LIKE ? OR lower(email) LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (query.status) { filters.push('status = ?'); values.push(query.status); } if (query.invoiceDelivery) { filters.push('invoice_delivery = ?'); values.push(query.invoiceDelivery); }
      if (query.month) { filters.push('substr(created_at, 1, 7) = ?'); values.push(query.month); }
      const where = filters.join(' AND '); const total = (database.prepare(`SELECT count(*) AS count FROM customers WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const items = database.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY company_name, id LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: items.map(parseCustomerRow), total };
    },
    getCustomer(context: TenantContext, customerId: string): CustomerRecord | null {
      return find(context.tenantId, customerId);
    },
    createCustomer(context: TenantContext, input: CustomerInput) {
      const customer = customerFields(input); const formatId = formatDefault(context.tenantId, input) ?? null; const id = `customer-${crypto.randomUUID()}`; const timestamp = now();
      database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, state_code, billing_address, invoice_delivery, status, invoice_format_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, context.tenantId, customer.companyName, customer.contactName, customer.email, customer.phone, customer.gstin, customer.stateCode, customer.billingAddress, customer.invoiceDelivery, 'active', formatId, timestamp, timestamp);
      return find(context.tenantId, id)!;
    },
    updateCustomer(context: TenantContext, customerId: string, input: CustomerInput) {
      const customer = customerFields(input); const formatId = formatDefault(context.tenantId, input);
      const changed = database.prepare('UPDATE customers SET company_name = ?, contact_name = ?, email = ?, phone = ?, gstin = ?, state_code = ?, billing_address = ?, invoice_delivery = ?, invoice_format_id = CASE WHEN ? THEN ? ELSE invoice_format_id END, updated_at = ? WHERE id = ? AND tenant_id = ?')
        .run(customer.companyName, customer.contactName, customer.email, customer.phone, customer.gstin, customer.stateCode, customer.billingAddress, customer.invoiceDelivery, formatId === undefined ? 0 : 1, formatId ?? null, now(), customerId, context.tenantId);
      if (!changed.changes) throw new Error('Customer not found.');
      return find(context.tenantId, customerId)!;
    },
    setCustomerStatus(context: TenantContext, customerId: string, status: CustomerStatus) {
      const changed = database.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, now(), customerId, context.tenantId);
      if (!changed.changes) throw new Error('Customer not found.');
      return find(context.tenantId, customerId)!;
    },
  };
}
