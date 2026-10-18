import type { DatabaseSync } from 'node:sqlite';
import { parseBillingState, parseGstin } from '../invoice-gst';
import { existingFormatId } from './invoice-formats';
import type { AppSession, CustomerStatus, InvoiceDelivery, CustomerRecord, CustomerInput, CustomerQuery } from './types';

function customerFromRow(row: Record<string, unknown>): CustomerRecord { return { id: String(row.id), tenantId: String(row.tenant_id), companyName: String(row.company_name), contactName: String(row.contact_name), email: String(row.email), phone: String(row.phone), gstin: String(row.gstin), stateCode: String(row.state_code), billingAddress: String(row.billing_address), invoiceDelivery: row.invoice_delivery as InvoiceDelivery, status: row.status as CustomerStatus, invoiceFormatId: row.invoice_format_id ? String(row.invoice_format_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function customerError(input: CustomerInput) { if (!input.companyName.trim()) return 'Company name is required.'; if (!input.contactName.trim()) return 'Contact name is required.'; if (!input.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return 'Enter a valid email address.'; if (!input.phone.trim()) return 'Phone is required.'; if (!input.billingAddress.trim()) return 'Billing address is required.'; return null; }
/** A registered client's state comes from the GSTIN. An unregistered client keeps the billing state that was chosen. */
function customerGst(input: CustomerInput) { const registration = parseGstin(input.gstin, 'client GSTIN'); const billingState = parseBillingState(input.stateCode); return { gstin: registration.gstin, stateCode: registration.gstin ? registration.stateCode : billingState }; }

export function createCustomerMethods(database: DatabaseSync) {
  /** undefined leaves the customer's default alone, null or blank clears it, anything else must be one of the tenant's own formats. */
  function formatDefault(tenantId: string, input: CustomerInput): string | null | undefined {
    if (input.invoiceFormatId === undefined) return undefined;
    if (!input.invoiceFormatId) return null;
    const id = existingFormatId(database, tenantId, input.invoiceFormatId);
    if (!id) throw new Error('The selected invoice format was not found.');
    return id;
  }
  return {
    listCustomers(session: AppSession, query: CustomerQuery = {}) {
      if (!session.tenantId) return { items: [] as CustomerRecord[], total: 0 };
      const search = query.search?.trim().toLowerCase() ?? ''; const filters = ['tenant_id = ?']; const values: (string | number)[] = [session.tenantId];
      if (search) { filters.push('(lower(company_name) LIKE ? OR lower(contact_name) LIKE ? OR lower(email) LIKE ?)'); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
      if (query.status) { filters.push('status = ?'); values.push(query.status); } if (query.invoiceDelivery) { filters.push('invoice_delivery = ?'); values.push(query.invoiceDelivery); }
      if (query.month) { filters.push('substr(created_at, 1, 7) = ?'); values.push(query.month); }
      const where = filters.join(' AND '); const total = (database.prepare(`SELECT count(*) AS count FROM customers WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const items = database.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY company_name LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: items.map(customerFromRow), total };
    },
    getCustomer(session: AppSession, customerId: string): CustomerRecord | null {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.');
      const row = database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown> | undefined;
      return row ? customerFromRow(row) : null;
    },
    createCustomer(session: AppSession, input: CustomerInput) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const error = customerError(input); if (error) throw new Error(error);
      const gst = customerGst(input); const formatId = formatDefault(session.tenantId, input) ?? null; const id = `customer-${crypto.randomUUID()}`; const now = new Date().toISOString();
      database.prepare('INSERT INTO customers (id, tenant_id, company_name, contact_name, email, phone, gstin, state_code, billing_address, invoice_delivery, status, invoice_format_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, session.tenantId, input.companyName.trim(), input.contactName.trim(), input.email.trim(), input.phone.trim(), gst.gstin, gst.stateCode, input.billingAddress.trim(), input.invoiceDelivery, 'active', formatId, now, now);
      return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(id, session.tenantId) as Record<string, unknown>);
    },
    updateCustomer(session: AppSession, customerId: string, input: CustomerInput) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const error = customerError(input); if (error) throw new Error(error); const gst = customerGst(input); const formatId = formatDefault(session.tenantId, input);
      const changed = database.prepare('UPDATE customers SET company_name = ?, contact_name = ?, email = ?, phone = ?, gstin = ?, state_code = ?, billing_address = ?, invoice_delivery = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(input.companyName.trim(), input.contactName.trim(), input.email.trim(), input.phone.trim(), gst.gstin, gst.stateCode, input.billingAddress.trim(), input.invoiceDelivery, new Date().toISOString(), customerId, session.tenantId);
      if (!changed.changes) throw new Error('Customer not found.');
      if (formatId !== undefined) database.prepare('UPDATE customers SET invoice_format_id = ? WHERE id = ? AND tenant_id = ?').run(formatId, customerId, session.tenantId); return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown>);
    },
    setCustomerStatus(session: AppSession, customerId: string, status: CustomerStatus) {
      if (!session.tenantId) throw new Error('Only tenant users can manage customers.'); const changed = database.prepare('UPDATE customers SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, new Date().toISOString(), customerId, session.tenantId);
      if (!changed.changes) throw new Error('Customer not found.'); return customerFromRow(database.prepare('SELECT * FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, session.tenantId) as Record<string, unknown>);
    },
  };
}
