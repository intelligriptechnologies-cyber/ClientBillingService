import type { DatabaseSync } from 'node:sqlite';
import { parseHsnSac } from '../invoice-gst';
import { requireTenantMember } from './shared';
import type { AppSession, TenantService, ServiceInput, ServiceUpdate } from './types';

export function serviceFromRow(row: Record<string, unknown>): TenantService {
  return { id: String(row.id), name: String(row.name), description: String(row.description), hsnSac: String(row.hsn_sac), status: row.status as TenantService['status'], prices: { monthly: Number(row.monthly_minor), quarterly: Number(row.quarterly_minor), halfYearly: Number(row.half_yearly_minor), annual: Number(row.annual_minor) }, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function validateServiceInput(input: ServiceInput) {
  if (!input.name.trim()) throw new Error('A service name is required.');
  parseHsnSac(input.hsnSac);
  for (const price of Object.values(input.prices)) if (!Number.isInteger(price) || price < 0) throw new Error('Service prices must be non-negative whole minor units.');
}

export function createServiceMethods(database: DatabaseSync) {
  return {
    listServices(session: AppSession, query = ''): TenantService[] {
      requireTenantMember(session);
      const search = `%${query.trim().toLowerCase()}%`;
      return (database.prepare(`SELECT * FROM services WHERE tenant_id = ? AND (lower(name) LIKE ? OR lower(description) LIKE ?) ORDER BY name COLLATE NOCASE`).all(session.tenantId, search, search) as Record<string, unknown>[]).map(serviceFromRow);
    },
    getService(session: AppSession, serviceId: string): TenantService | null {
      requireTenantMember(session);
      const row = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(serviceId, session.tenantId) as Record<string, unknown> | undefined;
      return row ? serviceFromRow(row) : null;
    },
    createService(session: AppSession, input: ServiceInput): TenantService {
      requireTenantMember(session);
      validateServiceInput(input);
      const id = `${session.tenantId}-service-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      try {
        database.prepare(`INSERT INTO services (id, tenant_id, name, description, hsn_sac, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
          .run(id, session.tenantId, input.name.trim(), input.description?.trim() ?? '', parseHsnSac(input.hsnSac), input.prices.monthly, input.prices.quarterly, input.prices.halfYearly, input.prices.annual, now, now);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A service with that name already exists in this tenant.');
        throw error;
      }
      return serviceFromRow(database.prepare('SELECT * FROM services WHERE id = ?').get(id) as Record<string, unknown>);
    },
    updateService(session: AppSession, serviceId: string, update: ServiceUpdate): TenantService {
      requireTenantMember(session);
      const current = database.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(serviceId, session.tenantId) as Record<string, unknown> | undefined;
      if (!current) throw new Error('This service does not belong to your tenant.');
      const input: ServiceInput = { name: update.name ?? String(current.name), description: update.description ?? String(current.description), hsnSac: update.hsnSac ?? String(current.hsn_sac), prices: update.prices ?? { monthly: Number(current.monthly_minor), quarterly: Number(current.quarterly_minor), halfYearly: Number(current.half_yearly_minor), annual: Number(current.annual_minor) } };
      validateServiceInput(input);
      const status = update.status ?? current.status as TenantService['status'];
      if (status !== 'active' && status !== 'inactive') throw new Error('Invalid service status.');
      try {
        database.prepare(`UPDATE services SET name = ?, description = ?, hsn_sac = ?, status = ?, monthly_minor = ?, quarterly_minor = ?, half_yearly_minor = ?, annual_minor = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(input.name.trim(), input.description?.trim() ?? '', parseHsnSac(input.hsnSac), status, input.prices.monthly, input.prices.quarterly, input.prices.halfYearly, input.prices.annual, new Date().toISOString(), serviceId, session.tenantId);
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new Error('A service with that name already exists in this tenant.');
        throw error;
      }
      return serviceFromRow(database.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) as Record<string, unknown>);
    },
  };
}
