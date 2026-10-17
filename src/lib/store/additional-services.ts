import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import type { AppSession, AdditionalServiceStatus, AdditionalService, AdditionalServiceInput, AdditionalServiceUpdate, AdditionalServiceQuery, AdditionalServiceList } from './types';

function additionalServiceFromRow(row: Record<string, unknown>): AdditionalService {
  return { id: String(row.id), tenantId: String(row.tenant_id), customerId: String(row.customer_id), customerName: String(row.customer_name), contractId: String(row.contract_id), contractName: String(row.contract_name), serviceDate: String(row.service_date), description: String(row.description), priceMinor: Number(row.price_minor), notes: String(row.notes), status: row.status as AdditionalServiceStatus, billedAt: row.billed_at ? String(row.billed_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function validateAdditionalServiceInput(input: AdditionalServiceInput) {
  if (!input.customerId || !input.contractId) throw new Error('Choose a customer and contract.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) throw new Error('Enter a valid service date.');
  if (!input.description.trim()) throw new Error('A service description is required.');
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) throw new Error('The customized price must be a non-negative whole minor unit.');
}

export function createAdditionalServiceMethods(database: DatabaseSync) {
  return {
    listAdditionalServices(session: AppSession, query: AdditionalServiceQuery = {}): AdditionalServiceList {
      requireTenantMember(session);
      const conditions = ['additional_services.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(additional_services.description) LIKE ? OR lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term, term); }
      if (query.customerId) { conditions.push('additional_services.customer_id = ?'); values.push(query.customerId); }
      if (query.contractId) { conditions.push('additional_services.contract_id = ?'); values.push(query.contractId); }
      if (query.status) { conditions.push('additional_services.status = ?'); values.push(query.status); }
      if (query.billingPeriod) { if (!/^\d{4}-\d{2}$/.test(query.billingPeriod)) throw new Error('Billing period must use YYYY-MM.'); conditions.push('additional_services.service_date LIKE ?'); values.push(`${query.billingPeriod}%`); }
      const where = conditions.join(' AND '); const joins = ' FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id ';
      const total = (database.prepare(`SELECT COUNT(*) AS count${joins}WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name${joins}WHERE ${where} ORDER BY additional_services.service_date DESC, additional_services.created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map(additionalServiceFromRow), total };
    },
    createAdditionalService(session: AppSession, input: AdditionalServiceInput): AdditionalService {
      requireTenantMember(session); validateAdditionalServiceInput(input);
      const contract = database.prepare(`SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ? AND contracts.status = 'active' AND customers.status = 'active'`).get(input.contractId, input.customerId, session.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected active customer in your tenant.');
      const timestamp = now(); const id = `${session.tenantId}-additional-${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO additional_services (id, tenant_id, customer_id, contract_id, service_date, description, price_minor, notes, status, billed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`).run(id, session.tenantId, input.customerId, input.contractId, input.serviceDate, input.description.trim(), input.priceMinor, input.notes?.trim() ?? '', timestamp, timestamp);
      const row = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id WHERE additional_services.id = ? AND additional_services.tenant_id = ?`).get(id, session.tenantId) as Record<string, unknown>;
      return additionalServiceFromRow(row);
    },
    updateAdditionalService(session: AppSession, additionalServiceId: string, update: AdditionalServiceUpdate): AdditionalService {
      requireTenantMember(session);
      const existing = database.prepare('SELECT * FROM additional_services WHERE id = ? AND tenant_id = ?').get(additionalServiceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('Additional service not found.');
      if (existing.billed_at) throw new Error('A billed additional service cannot be changed.');
      const input: AdditionalServiceInput = { customerId: update.customerId ?? String(existing.customer_id), contractId: update.contractId ?? String(existing.contract_id), serviceDate: update.serviceDate ?? String(existing.service_date), description: update.description ?? String(existing.description), priceMinor: update.priceMinor ?? Number(existing.price_minor), notes: update.notes ?? String(existing.notes) };
      validateAdditionalServiceInput(input); const status = update.status ?? existing.status as AdditionalServiceStatus;
      if (status !== 'active' && status !== 'archived') throw new Error('Additional service status is invalid.');
      const contract = database.prepare(`SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ?`).get(input.contractId, input.customerId, session.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected customer in your tenant.');
      database.prepare('UPDATE additional_services SET customer_id=?, contract_id=?, service_date=?, description=?, price_minor=?, notes=?, status=?, updated_at=? WHERE id=? AND tenant_id=?').run(input.customerId, input.contractId, input.serviceDate, input.description.trim(), input.priceMinor, input.notes?.trim() ?? '', status, now(), additionalServiceId, session.tenantId);
      const row = database.prepare(`SELECT additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id WHERE additional_services.id = ? AND additional_services.tenant_id = ?`).get(additionalServiceId, session.tenantId) as Record<string, unknown>;
      return additionalServiceFromRow(row);
    },
  };
}
