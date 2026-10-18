import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseAdditionalServiceRow } from './rows';
import { additionalServiceFields, checkBillingPeriod, updatedAdditionalService } from './rules';
import type { AdditionalService, AdditionalServiceInput, AdditionalServiceUpdate, AdditionalServiceQuery, AdditionalServiceList } from './types';

type Row = Record<string, unknown>;

const joined = ' FROM additional_services JOIN customers ON customers.id = additional_services.customer_id JOIN contracts ON contracts.id = additional_services.contract_id ';
const columns = 'additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name';

export function createAdditionalServiceMethods(database: DatabaseSync) {
  function find(tenantId: string, id: string): AdditionalService | null {
    const row = database.prepare(`SELECT ${columns}${joined}WHERE additional_services.id = ? AND additional_services.tenant_id = ?`).get(id, tenantId) as Row | undefined;
    return row ? parseAdditionalServiceRow(row) : null;
  }
  return {
    listAdditionalServices(context: TenantContext, query: AdditionalServiceQuery = {}): AdditionalServiceList {
      const conditions = ['additional_services.tenant_id = ?']; const values: Array<string | number> = [context.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(additional_services.description) LIKE ? OR lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); const term = `%${query.search.trim().toLowerCase()}%`; values.push(term, term, term); }
      if (query.customerId) { conditions.push('additional_services.customer_id = ?'); values.push(query.customerId); }
      if (query.contractId) { conditions.push('additional_services.contract_id = ?'); values.push(query.contractId); }
      if (query.status) { conditions.push('additional_services.status = ?'); values.push(query.status); }
      if (query.billingPeriod) { checkBillingPeriod(query.billingPeriod); conditions.push('additional_services.service_date LIKE ?'); values.push(`${query.billingPeriod}%`); }
      const where = conditions.join(' AND ');
      const total = (database.prepare(`SELECT COUNT(*) AS count${joined}WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`SELECT ${columns}${joined}WHERE ${where} ORDER BY additional_services.service_date DESC, additional_services.created_at DESC, additional_services.id LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: rows.map(parseAdditionalServiceRow), total };
    },
    createAdditionalService(context: TenantContext, input: AdditionalServiceInput): AdditionalService {
      const service = additionalServiceFields(input);
      const contract = database.prepare(`SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ? AND contracts.status = 'active' AND customers.status = 'active'`).get(service.contractId, service.customerId, context.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected active customer in your tenant.');
      const timestamp = now(); const id = `${context.tenantId}-additional-${crypto.randomUUID()}`;
      database.prepare(`INSERT INTO additional_services (id, tenant_id, customer_id, contract_id, service_date, description, price_minor, notes, status, billed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`)
        .run(id, context.tenantId, service.customerId, service.contractId, service.serviceDate, service.description, service.priceMinor, service.notes, timestamp, timestamp);
      return find(context.tenantId, id)!;
    },
    updateAdditionalService(context: TenantContext, additionalServiceId: string, update: AdditionalServiceUpdate): AdditionalService {
      const existing = find(context.tenantId, additionalServiceId);
      if (!existing) throw new Error('Additional service not found.');
      const service = updatedAdditionalService(existing, update);
      const contract = database.prepare('SELECT contracts.id FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.customer_id = ? AND contracts.tenant_id = ?').get(service.contractId, service.customerId, context.tenantId);
      if (!contract) throw new Error('The selected contract must belong to the selected customer in your tenant.');
      database.prepare('UPDATE additional_services SET customer_id=?, contract_id=?, service_date=?, description=?, price_minor=?, notes=?, status=?, updated_at=? WHERE id=? AND tenant_id=?')
        .run(service.customerId, service.contractId, service.serviceDate, service.description, service.priceMinor, service.notes, service.status, now(), additionalServiceId, context.tenantId);
      return find(context.tenantId, additionalServiceId)!;
    },
  };
}
