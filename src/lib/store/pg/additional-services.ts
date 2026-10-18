import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseAdditionalServiceRow } from '../rows';
import { additionalServiceFields, checkBillingPeriod, monthDays, updatedAdditionalService } from '../rules';
import { now } from '../shared';
import type { AdditionalService, AdditionalServiceInput, AdditionalServiceList, AdditionalServiceQuery, AdditionalServiceUpdate, TenantStore } from '../types';

type Row = Record<string, unknown>;

const joined = ` FROM additional_services
  JOIN customers ON customers.tenant_id = additional_services.tenant_id AND customers.id = additional_services.customer_id
  JOIN contracts ON contracts.tenant_id = additional_services.tenant_id AND contracts.id = additional_services.contract_id `;
const columns = 'additional_services.*, customers.company_name AS customer_name, contracts.name AS contract_name';

/** The tenant's additional service, or null. `forUpdate` locks its row, not the customer and contract it joins. */
async function find(tx: Tx, tenantId: string, id: string, forUpdate = false): Promise<AdditionalService | null> {
  const { rows } = await tx.query<Row>(`SELECT ${columns}${joined}WHERE additional_services.id = $1 AND additional_services.tenant_id = $2${forUpdate ? ' FOR UPDATE OF additional_services' : ''}`, [id, tenantId]);
  return rows[0] ? parseAdditionalServiceRow(rows[0]) : null;
}

export function createPgAdditionalServiceMethods(db: Database) {
  return {
    /** The billing period is a half-open range of days on the date column, where SQLite matches a text prefix. */
    async listAdditionalServices(context: TenantContext, query: AdditionalServiceQuery = {}): Promise<AdditionalServiceList> {
      const conditions = ['additional_services.tenant_id = $1'];
      const values: unknown[] = [context.tenantId];
      const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
      const search = query.search?.trim().toLowerCase();
      if (search) where((p) => `(lower(additional_services.description) LIKE ${p} ESCAPE '' OR lower(contracts.name) LIKE ${p} ESCAPE '' OR lower(customers.company_name) LIKE ${p} ESCAPE '')`, `%${search}%`);
      if (query.customerId) where((p) => `additional_services.customer_id = ${p}`, query.customerId);
      if (query.contractId) where((p) => `additional_services.contract_id = ${p}`, query.contractId);
      if (query.status) where((p) => `additional_services.status = ${p}`, query.status);
      if (query.billingPeriod) {
        checkBillingPeriod(query.billingPeriod);
        const days = monthDays(query.billingPeriod);
        if (!days) conditions.push('false');
        else { where((p) => `additional_services.service_date >= ${p}`, days.start); where((p) => `additional_services.service_date < ${p}`, days.end); }
      }
      const clause = conditions.join(' AND ');
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      return db.withTenant(context.tenantId, async (tx) => {
        const total = Number((await tx.query<Row>(`SELECT count(*) AS count${joined}WHERE ${clause}`, values)).rows[0].count);
        const { rows } = await tx.query<Row>(
          `SELECT ${columns}${joined}WHERE ${clause} ORDER BY additional_services.service_date DESC, additional_services.created_at DESC, additional_services.id COLLATE "C" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        );
        return { items: rows.map(parseAdditionalServiceRow), total };
      });
    },
    async createAdditionalService(context: TenantContext, input: AdditionalServiceInput): Promise<AdditionalService> {
      const service = additionalServiceFields(input);
      return db.withTenant(context.tenantId, async (tx) => {
        const contract = await tx.query(
          `SELECT 1 FROM contracts JOIN customers ON customers.tenant_id = contracts.tenant_id AND customers.id = contracts.customer_id
           WHERE contracts.id = $1 AND contracts.customer_id = $2 AND contracts.tenant_id = $3 AND contracts.status = 'active' AND customers.status = 'active'`,
          [service.contractId, service.customerId, context.tenantId],
        );
        if (!contract.rows[0]) throw new Error('The selected contract must belong to the selected active customer in your tenant.');
        const id = `${context.tenantId}-additional-${crypto.randomUUID()}`; const timestamp = now();
        await tx.query(
          `INSERT INTO additional_services (id, tenant_id, customer_id, contract_id, service_date, description, price_minor, notes, status, billed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NULL, $9, $9)`,
          [id, context.tenantId, service.customerId, service.contractId, service.serviceDate, service.description, service.priceMinor, service.notes, timestamp],
        );
        return (await find(tx, context.tenantId, id))!;
      });
    },
    /** Locks the row before the billed check and the merge, so a change cannot land on a service billed meanwhile or write back another change's old values. */
    async updateAdditionalService(context: TenantContext, additionalServiceId: string, update: AdditionalServiceUpdate): Promise<AdditionalService> {
      return db.withTenant(context.tenantId, async (tx) => {
        const existing = await find(tx, context.tenantId, additionalServiceId, true);
        if (!existing) throw new Error('Additional service not found.');
        const service = updatedAdditionalService(existing, update);
        const contract = await tx.query(
          `SELECT 1 FROM contracts JOIN customers ON customers.tenant_id = contracts.tenant_id AND customers.id = contracts.customer_id WHERE contracts.id = $1 AND contracts.customer_id = $2 AND contracts.tenant_id = $3`,
          [service.contractId, service.customerId, context.tenantId],
        );
        if (!contract.rows[0]) throw new Error('The selected contract must belong to the selected customer in your tenant.');
        await tx.query(
          'UPDATE additional_services SET customer_id = $1, contract_id = $2, service_date = $3, description = $4, price_minor = $5, notes = $6, status = $7, updated_at = $8 WHERE id = $9 AND tenant_id = $10',
          [service.customerId, service.contractId, service.serviceDate, service.description, service.priceMinor, service.notes, service.status, now(), additionalServiceId, context.tenantId],
        );
        return (await find(tx, context.tenantId, additionalServiceId))!;
      });
    },
  } satisfies Partial<TenantStore>;
}
