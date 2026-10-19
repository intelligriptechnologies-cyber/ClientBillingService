import type { TenantContext } from '../../auth/principal';
import type { Database, Tx } from '../../db/database';
import { parseContractAuditRow, parseContractRow, parseContractServiceRow, parseDepositRow } from '../rows';
import { CONTRACT_CUSTOMER_MESSAGE, CONTRACT_SERVICE_MESSAGE, contractFields, FOREIGN_CONTRACT_MESSAGE, FOREIGN_DEPOSIT_MESSAGE, monthRange, renewal, renewalPage, settlement, updatedContract } from '../rules';
import { now } from '../shared';
import type { Contract, ContractAuditEvent, ContractInput, ContractList, ContractQuery, ContractUpdate, DepositSettlementInput, RenewalList, RenewalQuery, SecurityDeposit, TenantStore } from '../types';

type Row = Record<string, unknown>;
type ContractFields = ReturnType<typeof contractFields>;

const contractWithCustomer = 'SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.tenant_id = contracts.tenant_id AND customers.id = contracts.customer_id';

/** Contracts with the services each covers, in bytewise name order. Bulk invoicing reads contracts through it too. */
export async function withServices(tx: Tx, tenantId: string, rows: Row[]): Promise<Contract[]> {
  if (!rows.length) return [];
  const { rows: services } = await tx.query<Row>(
    `SELECT contract_services.contract_id, services.id, services.name FROM contract_services JOIN services ON services.tenant_id = contract_services.tenant_id AND services.id = contract_services.service_id
     WHERE contract_services.tenant_id = $1 AND contract_services.contract_id = ANY($2) ORDER BY services.name COLLATE "C", services.id COLLATE "C"`,
    [tenantId, rows.map((row) => row.id)],
  );
  return rows.map((row) => parseContractRow(row, services.filter((service) => service.contract_id === row.id).map(parseContractServiceRow)));
}

/** The tenant's contract. `forUpdate` locks the contracts row, not the customer it joins. */
async function find(tx: Tx, tenantId: string, contractId: string, forUpdate = false): Promise<Contract> {
  const { rows } = await tx.query<Row>(`${contractWithCustomer} WHERE contracts.id = $1 AND contracts.tenant_id = $2${forUpdate ? ' FOR UPDATE OF contracts' : ''}`, [contractId, tenantId]);
  if (!rows[0]) throw new Error(FOREIGN_CONTRACT_MESSAGE);
  return (await withServices(tx, tenantId, rows))[0];
}

async function checkReferences(tx: Tx, tenantId: string, contract: ContractFields) {
  const customer = await tx.query(`SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [contract.customerId, tenantId]);
  if (!customer.rows[0]) throw new Error(CONTRACT_CUSTOMER_MESSAGE);
  const services = await tx.query<Row>(`SELECT count(*) AS count FROM services WHERE id = ANY($1) AND tenant_id = $2 AND status = 'active'`, [contract.serviceIds, tenantId]);
  if (Number(services.rows[0].count) !== contract.serviceIds.length) throw new Error(CONTRACT_SERVICE_MESSAGE);
}

/** clock_timestamp() rather than now(): events written in one transaction still sort in the order written. */
async function audit(tx: Tx, tenantId: string, contractId: string, action: string, detail: string) {
  await tx.query('INSERT INTO contract_audit_events (id, tenant_id, contract_id, action, detail, occurred_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp())', [crypto.randomUUID(), tenantId, contractId, action, detail]);
}

async function linkServices(tx: Tx, tenantId: string, contractId: string, serviceIds: string[]) {
  for (const serviceId of serviceIds) await tx.query('INSERT INTO contract_services (tenant_id, contract_id, service_id) VALUES ($1, $2, $3)', [tenantId, contractId, serviceId]);
}

async function deposits(tx: Tx, tenantId: string, depositId?: string): Promise<SecurityDeposit[]> {
  const { rows } = await tx.query<Row>(
    `SELECT security_deposits.*, customers.company_name AS customer_name FROM security_deposits JOIN customers ON customers.tenant_id = security_deposits.tenant_id AND customers.id = security_deposits.customer_id
     WHERE security_deposits.tenant_id = $1 AND ($2::text IS NULL OR security_deposits.id = $2) ORDER BY security_deposits.created_at DESC, security_deposits.id COLLATE "C"`,
    [tenantId, depositId ?? null],
  );
  return rows.map(parseDepositRow);
}

/** The contract search, as conditions on `contracts` joined with `customers`. ESCAPE '' leaves LIKE with no escape character. */
function contractFilters(tenantId: string, query: ContractQuery) {
  const conditions = ['contracts.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const where = (sql: (placeholder: string) => string, value: unknown) => { values.push(value); conditions.push(sql(`$${values.length}`)); };
  const search = query.search?.trim().toLowerCase();
  if (search) where((p) => `(lower(contracts.name) LIKE ${p} ESCAPE '' OR lower(customers.company_name) LIKE ${p} ESCAPE '')`, `%${search}%`);
  if (query.status) where((p) => `contracts.status = ${p}`, query.status);
  if (query.month) {
    const range = monthRange(query.month);
    if (!range) conditions.push('false');
    else { where((p) => `contracts.created_at >= ${p}`, range.start); where((p) => `contracts.created_at < ${p}`, range.end); }
  }
  if (query.customerId) where((p) => `contracts.customer_id = ${p}`, query.customerId);
  return { clause: conditions.join(' AND '), values };
}

const contractColumns = (contract: ContractFields) => [contract.customerId, contract.name, contract.startDate, contract.endDate, contract.valueMinor, contract.paymentTermsDays, contract.billingFrequency,
  JSON.stringify(contract.invoiceMonths), contract.cycleDay, contract.escalationPercent, contract.escalationReviewDate, contract.renewalNoticeDays, contract.securityDepositMinor];

export function createPgContractMethods(db: Database) {
  return {
    async listContracts(context: TenantContext, query: ContractQuery = {}): Promise<ContractList> {
      const { clause, values } = contractFilters(context.tenantId, query);
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      return db.withTenant(context.tenantId, async (tx) => {
        const total = Number((await tx.query<Row>(`SELECT count(*) AS count FROM contracts JOIN customers ON customers.tenant_id = contracts.tenant_id AND customers.id = contracts.customer_id WHERE ${clause}`, values)).rows[0].count);
        const { rows } = await tx.query<Row>(`${contractWithCustomer} WHERE ${clause} ORDER BY contracts.created_at DESC, contracts.id COLLATE "C" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
        return { items: await withServices(tx, context.tenantId, rows), total };
      });
    },
    async createContract(context: TenantContext, input: ContractInput): Promise<Contract> {
      const contract = contractFields(input);
      const id = `${context.tenantId}-contract-${crypto.randomUUID()}`;
      return db.withTenant(context.tenantId, async (tx) => {
        await checkReferences(tx, context.tenantId, contract);
        const timestamp = now();
        await tx.query(
          `INSERT INTO contracts (id, tenant_id, customer_id, name, start_date, end_date, value_minor, payment_terms_days, billing_frequency, invoice_months, cycle_day, escalation_percent, escalation_review_date, renewal_notice_days, security_deposit_minor, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active', $16, $16)`,
          [id, context.tenantId, ...contractColumns(contract), timestamp],
        );
        await linkServices(tx, context.tenantId, id, contract.serviceIds);
        await audit(tx, context.tenantId, id, 'created', 'Contract created.');
        if (contract.securityDepositMinor > 0) await tx.query(`INSERT INTO security_deposits (id, tenant_id, contract_id, customer_id, amount_minor, status, created_at) VALUES ($1, $2, $3, $4, $5, 'held', $6)`, [crypto.randomUUID(), context.tenantId, id, contract.customerId, contract.securityDepositMinor, timestamp]);
        return find(tx, context.tenantId, id);
      });
    },
    /** Locks the contract before merging, so two partial updates cannot each write back the other's old values or relink its services at once. */
    async updateContract(context: TenantContext, contractId: string, update: ContractUpdate): Promise<Contract> {
      return db.withTenant(context.tenantId, async (tx) => {
        const contract = updatedContract(await find(tx, context.tenantId, contractId, true), update);
        await checkReferences(tx, context.tenantId, contract);
        await tx.query(
          `UPDATE contracts SET customer_id = $1, name = $2, start_date = $3, end_date = $4, value_minor = $5, payment_terms_days = $6, billing_frequency = $7, invoice_months = $8, cycle_day = $9,
             escalation_percent = $10, escalation_review_date = $11, renewal_notice_days = $12, security_deposit_minor = $13, status = $14, updated_at = $15
           WHERE id = $16 AND tenant_id = $17`,
          [...contractColumns(contract), contract.status, now(), contractId, context.tenantId],
        );
        await tx.query('DELETE FROM contract_services WHERE contract_id = $1 AND tenant_id = $2', [contractId, context.tenantId]);
        await linkServices(tx, context.tenantId, contractId, contract.serviceIds);
        await audit(tx, context.tenantId, contractId, 'updated', `Contract ${contract.status}.`);
        return find(tx, context.tenantId, contractId);
      });
    },
    async listRenewals(context: TenantContext, query: RenewalQuery = {}): Promise<RenewalList> {
      const { clause, values } = contractFilters(context.tenantId, { search: query.search });
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>(`${contractWithCustomer} WHERE ${clause} ORDER BY contracts.created_at DESC, contracts.id COLLATE "C"`, values);
        return renewalPage(await withServices(tx, context.tenantId, rows), query);
      });
    },
    async listContractAudit(context: TenantContext, contractId: string): Promise<ContractAuditEvent[]> {
      return db.withTenant(context.tenantId, async (tx) => {
        const owned = await tx.query('SELECT 1 FROM contracts WHERE id = $1 AND tenant_id = $2', [contractId, context.tenantId]);
        if (!owned.rows[0]) throw new Error(FOREIGN_CONTRACT_MESSAGE);
        return (await tx.query<Row>('SELECT id, action, detail, occurred_at FROM contract_audit_events WHERE contract_id = $1 AND tenant_id = $2 ORDER BY occurred_at DESC, id COLLATE "C"', [contractId, context.tenantId])).rows.map(parseContractAuditRow);
      });
    },
    /** Locks the contract before comparing end dates, so a renewal never lands on top of a later one it did not see. */
    async renewContract(context: TenantContext, contractId: string, input: { endDate: string; note: string }): Promise<Contract> {
      return db.withTenant(context.tenantId, async (tx) => {
        const renewed = renewal((await find(tx, context.tenantId, contractId, true)).endDate, input);
        await tx.query(`UPDATE contracts SET end_date = $1, status = 'active', updated_at = $2 WHERE id = $3 AND tenant_id = $4`, [renewed.endDate, now(), contractId, context.tenantId]);
        await audit(tx, context.tenantId, contractId, 'renewed', renewed.note);
        return find(tx, context.tenantId, contractId);
      });
    },
    async listSecurityDeposits(context: TenantContext): Promise<SecurityDeposit[]> {
      return db.withTenant(context.tenantId, (tx) => deposits(tx, context.tenantId));
    },
    /** Locks the deposit before reading its balance, so two settlements cannot both spend the same balance. */
    async settleSecurityDeposit(context: TenantContext, depositId: string, input: DepositSettlementInput): Promise<SecurityDeposit> {
      return db.withTenant(context.tenantId, async (tx) => {
        const { rows } = await tx.query<Row>('SELECT contract_id, amount_minor, settled_minor, status FROM security_deposits WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [depositId, context.tenantId]);
        if (!rows[0]) throw new Error(FOREIGN_DEPOSIT_MESSAGE);
        const settled = settlement({ amountMinor: Number(rows[0].amount_minor), settledMinor: Number(rows[0].settled_minor), status: rows[0].status === 'settled' ? 'settled' : 'held' }, input);
        const timestamp = now();
        await tx.query('INSERT INTO security_deposit_settlements (id, tenant_id, deposit_id, amount_minor, note, settled_at) VALUES ($1, $2, $3, $4, $5, $6)', [crypto.randomUUID(), context.tenantId, depositId, input.amountMinor, settled.note, timestamp]);
        await tx.query('UPDATE security_deposits SET settled_minor = $1, settlement_note = $2, settled_at = $3, status = $4 WHERE id = $5 AND tenant_id = $6', [settled.settledMinor, settled.note, settled.status === 'settled' ? timestamp : null, settled.status, depositId, context.tenantId]);
        await audit(tx, context.tenantId, String(rows[0].contract_id), 'deposit-settled', `Security deposit settlement of ${input.amountMinor} recorded.`);
        return (await deposits(tx, context.tenantId, depositId))[0];
      });
    },
  } satisfies Partial<TenantStore>;
}
