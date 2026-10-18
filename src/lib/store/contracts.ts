import type { DatabaseSync } from 'node:sqlite';
import type { TenantContext } from '../auth/principal';
import { now } from './shared';
import { parseContractAuditRow, parseContractRow, parseContractServiceRow, parseDepositRow } from './rows';
import { CONTRACT_CUSTOMER_MESSAGE, CONTRACT_SERVICE_MESSAGE, contractFields, FOREIGN_CONTRACT_MESSAGE, FOREIGN_DEPOSIT_MESSAGE, renewal, renewalPage, settlement, updatedContract } from './rules';
import type { Contract, ContractInput, ContractUpdate, ContractQuery, ContractList, SecurityDeposit, DepositSettlementInput, ContractAuditEvent, RenewalQuery, RenewalList } from './types';

type Row = Record<string, unknown>;
type ContractFields = ReturnType<typeof contractFields>;

const contractWithCustomer = 'SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id';

/** A contracts row joined with its customer's name, with the services it covers. Bulk invoicing reads contracts through it too. */
export function contractWithServices(database: DatabaseSync, row: Row): Contract {
  const services = database.prepare('SELECT services.id, services.name FROM contract_services JOIN services ON services.id = contract_services.service_id WHERE contract_services.contract_id = ? ORDER BY services.name, services.id').all(String(row.id)) as Row[];
  return parseContractRow(row, services.map(parseContractServiceRow));
}

export function createContractMethods(database: DatabaseSync) {
  function find(tenantId: string, contractId: string): Contract {
    const row = database.prepare(`${contractWithCustomer} WHERE contracts.id = ? AND contracts.tenant_id = ?`).get(contractId, tenantId) as Row | undefined;
    if (!row) throw new Error(FOREIGN_CONTRACT_MESSAGE);
    return contractWithServices(database, row);
  }
  function checkReferences(tenantId: string, contract: ContractFields) {
    if (!database.prepare("SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND status = 'active'").get(contract.customerId, tenantId)) throw new Error(CONTRACT_CUSTOMER_MESSAGE);
    const service = database.prepare("SELECT id FROM services WHERE id = ? AND tenant_id = ? AND status = 'active'");
    if (contract.serviceIds.some((serviceId) => !service.get(serviceId, tenantId))) throw new Error(CONTRACT_SERVICE_MESSAGE);
  }
  function audit(contractId: string, action: string, detail: string, at: string) {
    database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), contractId, action, detail, at);
  }
  function linkServices(contractId: string, serviceIds: string[]) {
    const insert = database.prepare('INSERT INTO contract_services (contract_id, service_id) VALUES (?, ?)');
    for (const serviceId of serviceIds) insert.run(contractId, serviceId);
  }
  function inTransaction(work: () => void) {
    database.exec('BEGIN');
    try { work(); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function deposits(tenantId: string): SecurityDeposit[] {
    return (database.prepare('SELECT security_deposits.*, customers.company_name AS customer_name FROM security_deposits JOIN customers ON customers.id = security_deposits.customer_id WHERE security_deposits.tenant_id = ? ORDER BY security_deposits.created_at DESC, security_deposits.id').all(tenantId) as Row[]).map(parseDepositRow);
  }
  return {
    listContracts(context: TenantContext, query: ContractQuery = {}): ContractList {
      const conditions = ['contracts.tenant_id = ?']; const values: Array<string | number> = [context.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); values.push(`%${query.search.trim().toLowerCase()}%`, `%${query.search.trim().toLowerCase()}%`); }
      if (query.status) { conditions.push('contracts.status = ?'); values.push(query.status); }
      if (query.month) { conditions.push('substr(contracts.created_at, 1, 7) = ?'); values.push(query.month); }
      if (query.customerId) { conditions.push('contracts.customer_id = ?'); values.push(query.customerId); }
      const where = conditions.join(' AND '); const total = (database.prepare(`SELECT COUNT(*) AS count FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`${contractWithCustomer} WHERE ${where} ORDER BY contracts.created_at DESC, contracts.id LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
      return { items: rows.map((row) => contractWithServices(database, row)), total };
    },
    createContract(context: TenantContext, input: ContractInput): Contract {
      const contract = contractFields(input);
      checkReferences(context.tenantId, contract);
      const id = `${context.tenantId}-contract-${crypto.randomUUID()}`; const timestamp = now();
      inTransaction(() => {
        database.prepare("INSERT INTO contracts (id, tenant_id, customer_id, name, start_date, end_date, value_minor, payment_terms_days, billing_frequency, invoice_months, cycle_day, escalation_percent, escalation_review_date, renewal_notice_days, security_deposit_minor, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
          .run(id, context.tenantId, contract.customerId, contract.name, contract.startDate, contract.endDate, contract.valueMinor, contract.paymentTermsDays, contract.billingFrequency, JSON.stringify(contract.invoiceMonths), contract.cycleDay, contract.escalationPercent, contract.escalationReviewDate, contract.renewalNoticeDays, contract.securityDepositMinor, timestamp, timestamp);
        linkServices(id, contract.serviceIds);
        audit(id, 'created', 'Contract created.', timestamp);
        if (contract.securityDepositMinor > 0) database.prepare("INSERT INTO security_deposits (id, tenant_id, contract_id, customer_id, amount_minor, status, created_at) VALUES (?, ?, ?, ?, ?, 'held', ?)").run(crypto.randomUUID(), context.tenantId, id, contract.customerId, contract.securityDepositMinor, timestamp);
      });
      return find(context.tenantId, id);
    },
    updateContract(context: TenantContext, contractId: string, update: ContractUpdate): Contract {
      const contract = updatedContract(find(context.tenantId, contractId), update);
      checkReferences(context.tenantId, contract);
      const timestamp = now();
      inTransaction(() => {
        database.prepare('UPDATE contracts SET customer_id=?, name=?, start_date=?, end_date=?, value_minor=?, payment_terms_days=?, billing_frequency=?, invoice_months=?, cycle_day=?, escalation_percent=?, escalation_review_date=?, renewal_notice_days=?, security_deposit_minor=?, status=?, updated_at=? WHERE id=? AND tenant_id=?')
          .run(contract.customerId, contract.name, contract.startDate, contract.endDate, contract.valueMinor, contract.paymentTermsDays, contract.billingFrequency, JSON.stringify(contract.invoiceMonths), contract.cycleDay, contract.escalationPercent, contract.escalationReviewDate, contract.renewalNoticeDays, contract.securityDepositMinor, contract.status, timestamp, contractId, context.tenantId);
        database.prepare('DELETE FROM contract_services WHERE contract_id = ?').run(contractId);
        linkServices(contractId, contract.serviceIds);
        audit(contractId, 'updated', `Contract ${contract.status}.`, timestamp);
      });
      return find(context.tenantId, contractId);
    },
    listRenewals(context: TenantContext, query: RenewalQuery = {}): RenewalList {
      const search = query.search?.trim().toLowerCase();
      const clauses = ['contracts.tenant_id = ?']; const values: string[] = [context.tenantId];
      if (search) { clauses.push('(lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); values.push(`%${search}%`, `%${search}%`); }
      const rows = database.prepare(`${contractWithCustomer} WHERE ${clauses.join(' AND ')} ORDER BY contracts.created_at DESC, contracts.id`).all(...values) as Row[];
      return renewalPage(rows.map((row) => contractWithServices(database, row)), query);
    },
    listContractAudit(context: TenantContext, contractId: string): ContractAuditEvent[] {
      if (!database.prepare('SELECT id FROM contracts WHERE id = ? AND tenant_id = ?').get(contractId, context.tenantId)) throw new Error(FOREIGN_CONTRACT_MESSAGE);
      return (database.prepare('SELECT id, action, detail, occurred_at FROM contract_audit_events WHERE contract_id = ? ORDER BY occurred_at DESC').all(contractId) as Row[]).map(parseContractAuditRow);
    },
    renewContract(context: TenantContext, contractId: string, input: { endDate: string; note: string }): Contract {
      const renewed = renewal(find(context.tenantId, contractId).endDate, input);
      const timestamp = now();
      inTransaction(() => {
        database.prepare("UPDATE contracts SET end_date = ?, status = 'active', updated_at = ? WHERE id = ? AND tenant_id = ?").run(renewed.endDate, timestamp, contractId, context.tenantId);
        audit(contractId, 'renewed', renewed.note, timestamp);
      });
      return find(context.tenantId, contractId);
    },
    listSecurityDeposits(context: TenantContext): SecurityDeposit[] {
      return deposits(context.tenantId);
    },
    settleSecurityDeposit(context: TenantContext, depositId: string, input: DepositSettlementInput): SecurityDeposit {
      const row = database.prepare('SELECT * FROM security_deposits WHERE id = ? AND tenant_id = ?').get(depositId, context.tenantId) as Row | undefined;
      if (!row) throw new Error(FOREIGN_DEPOSIT_MESSAGE);
      const settled = settlement({ amountMinor: Number(row.amount_minor), settledMinor: Number(row.settled_minor), status: row.status === 'settled' ? 'settled' : 'held' }, input);
      const timestamp = now();
      inTransaction(() => {
        database.prepare('INSERT INTO security_deposit_settlements (id, deposit_id, tenant_id, amount_minor, note, settled_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), depositId, context.tenantId, input.amountMinor, settled.note, timestamp);
        database.prepare('UPDATE security_deposits SET settled_minor = ?, settlement_note = ?, settled_at = ?, status = ? WHERE id = ? AND tenant_id = ?').run(settled.settledMinor, settled.note, settled.status === 'settled' ? timestamp : null, settled.status, depositId, context.tenantId);
        audit(String(row.contract_id), 'deposit-settled', `Security deposit settlement of ${input.amountMinor} recorded.`, timestamp);
      });
      return deposits(context.tenantId).find((deposit) => deposit.id === depositId)!;
    },
  };
}
