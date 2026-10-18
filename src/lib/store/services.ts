import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseServiceRow } from './rows';
import { DUPLICATE_SERVICE_MESSAGE, serviceFields, updatedService } from './rules';
import type { TenantService, ServiceInput, ServiceUpdate } from './types';

type Row = Record<string, unknown>;

export function createServiceMethods(database: DatabaseSync) {
  function find(tenantId: string, serviceId: string): TenantService | null {
    const row = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(serviceId, tenantId) as Row | undefined;
    return row ? parseServiceRow(row) : null;
  }
  function duplicateName(error: unknown): never {
    if (String(error).includes('UNIQUE')) throw new Error(DUPLICATE_SERVICE_MESSAGE);
    throw error;
  }
  return {
    listServices(context: TenantContext, query = ''): TenantService[] {
      const search = `%${query.trim().toLowerCase()}%`;
      return (database.prepare('SELECT * FROM services WHERE tenant_id = ? AND (lower(name) LIKE ? OR lower(description) LIKE ?) ORDER BY name COLLATE NOCASE, id').all(context.tenantId, search, search) as Row[]).map(parseServiceRow);
    },
    getService(context: TenantContext, serviceId: string): TenantService | null {
      return find(context.tenantId, serviceId);
    },
    createService(context: TenantContext, input: ServiceInput): TenantService {
      const service = serviceFields(input);
      const id = `${context.tenantId}-service-${crypto.randomUUID()}`;
      const timestamp = now();
      try {
        database.prepare(`INSERT INTO services (id, tenant_id, name, description, hsn_sac, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
          .run(id, context.tenantId, service.name, service.description, service.hsnSac, service.prices.monthly, service.prices.quarterly, service.prices.halfYearly, service.prices.annual, timestamp, timestamp);
      } catch (error) { duplicateName(error); }
      return find(context.tenantId, id)!;
    },
    updateService(context: TenantContext, serviceId: string, update: ServiceUpdate): TenantService {
      const current = find(context.tenantId, serviceId);
      if (!current) throw new Error('This service does not belong to your tenant.');
      const service = updatedService(current, update);
      try {
        database.prepare('UPDATE services SET name = ?, description = ?, hsn_sac = ?, status = ?, monthly_minor = ?, quarterly_minor = ?, half_yearly_minor = ?, annual_minor = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(service.name, service.description, service.hsnSac, service.status, service.prices.monthly, service.prices.quarterly, service.prices.halfYearly, service.prices.annual, now(), serviceId, context.tenantId);
      } catch (error) { duplicateName(error); }
      return find(context.tenantId, serviceId)!;
    },
  };
}
