import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseServiceRow } from '../rows';
import { DUPLICATE_SERVICE_MESSAGE, serviceFields, updatedService } from '../rules';
import { now } from '../shared';
import type { ServiceInput, ServiceUpdate, TenantService, TenantStore } from '../types';
import { renameUniqueViolation } from './shared';

type Row = Record<string, unknown>;

const duplicateName = renameUniqueViolation(['services_tenant_id_name_key'], DUPLICATE_SERVICE_MESSAGE);

/** The tenant's service, or null. `forUpdate` locks the row until the transaction ends. */
export async function findService(tx: Tx, tenantId: string, serviceId: string, forUpdate = false): Promise<TenantService | null> {
  const { rows } = await tx.query<Row>(`SELECT * FROM services WHERE id = $1 AND tenant_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [serviceId, tenantId]);
  return rows[0] ? parseServiceRow(rows[0]) : null;
}

export function createPgServiceMethods(db: Database) {
  return {
    /** ESCAPE '' keeps LIKE's wildcards and no escape character. */
    async listServices(context: TenantContext, query = ''): Promise<TenantService[]> {
      const search = `%${query.trim().toLowerCase()}%`;
      return db.withTenant(context.tenantId, async (tx) => (await tx.query<Row>(`SELECT * FROM services WHERE tenant_id = $1 AND (lower(name) LIKE $2 ESCAPE '' OR lower(description) LIKE $2 ESCAPE '') ORDER BY lower(name), id COLLATE "C"`, [context.tenantId, search])).rows.map(parseServiceRow));
    },
    async getService(context: TenantContext, serviceId: string): Promise<TenantService | null> {
      return db.withTenant(context.tenantId, (tx) => findService(tx, context.tenantId, serviceId));
    },
    async createService(context: TenantContext, input: ServiceInput): Promise<TenantService> {
      const service = serviceFields(input);
      const timestamp = now();
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>(
          `INSERT INTO services (id, tenant_id, name, description, hsn_sac, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $10) RETURNING *`,
          [`${context.tenantId}-service-${crypto.randomUUID()}`, context.tenantId, service.name, service.description, service.hsnSac, service.prices.monthly, service.prices.quarterly, service.prices.halfYearly, service.prices.annual, timestamp],
        );
        return parseServiceRow(rows[0]);
      }).catch(duplicateName);
    },
    /** Locks the row before merging, so two partial updates cannot each write back the other's old values. */
    async updateService(context: TenantContext, serviceId: string, update: ServiceUpdate): Promise<TenantService> {
      return db.withTenant(context.tenantId, async (tx) => {
        const current = await findService(tx, context.tenantId, serviceId, true);
        if (!current) throw new Error('This service does not belong to your tenant.');
        const service = updatedService(current, update);
        const { rows } = await tx.query<Row>(
          `UPDATE services SET name = $1, description = $2, hsn_sac = $3, status = $4, monthly_minor = $5, quarterly_minor = $6, half_yearly_minor = $7, annual_minor = $8, updated_at = $9
           WHERE id = $10 AND tenant_id = $11 RETURNING *`,
          [service.name, service.description, service.hsnSac, service.status, service.prices.monthly, service.prices.quarterly, service.prices.halfYearly, service.prices.annual, now(), serviceId, context.tenantId],
        );
        return parseServiceRow(rows[0]);
      }).catch(duplicateName);
    },
  } satisfies Partial<TenantStore>;
}
