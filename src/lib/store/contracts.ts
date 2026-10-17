import type { DatabaseSync } from 'node:sqlite';
import { now, requireTenantMember } from './shared';
import type { AppSession, BillingFrequency, ContractStatus, Contract, ContractInput, ContractUpdate, ContractQuery, ContractList, SecurityDeposit, DepositSettlementInput, ContractAuditEvent, RenewalStatus, RenewalRecord, RenewalQuery, RenewalList } from './types';

export function contractFromRow(database: DatabaseSync, row: Record<string, unknown>): Contract {
  const serviceRows = database.prepare('SELECT services.id, services.name FROM contract_services JOIN services ON services.id = contract_services.service_id WHERE contract_services.contract_id = ? ORDER BY services.name').all(String(row.id)) as Array<{ id: string; name: string }>;
  return { id: String(row.id), tenantId: String(row.tenant_id), customerId: String(row.customer_id), customerName: String(row.customer_name), name: String(row.name), serviceIds: serviceRows.map((service) => service.id), services: serviceRows.map((service) => service.name), startDate: String(row.start_date), endDate: String(row.end_date), valueMinor: Number(row.value_minor), paymentTermsDays: Number(row.payment_terms_days), billingFrequency: row.billing_frequency as BillingFrequency, invoiceMonths: JSON.parse(String(row.invoice_months)) as number[], cycleDay: Number(row.cycle_day), escalationPercent: Number(row.escalation_percent), escalationReviewDate: row.escalation_review_date ? String(row.escalation_review_date) : null, renewalNoticeDays: Number(row.renewal_notice_days), securityDepositMinor: Number(row.security_deposit_minor), status: row.status as ContractStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function validateContractInput(input: ContractInput) {
  if (!input.name.trim()) throw new Error('Contract name is required.');
  if (!input.customerId) throw new Error('Choose a customer.');
  if (!input.serviceIds.length) throw new Error('Choose at least one service.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate < input.startDate) throw new Error('Enter a valid contract date range.');
  if (!Number.isInteger(input.valueMinor) || input.valueMinor < 0 || !Number.isInteger(input.securityDepositMinor) || input.securityDepositMinor < 0) throw new Error('Contract value and security deposit must be non-negative.');
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || !Number.isInteger(input.cycleDay) || input.cycleDay < 1 || input.cycleDay > 31 || !Number.isInteger(input.renewalNoticeDays) || input.renewalNoticeDays < 0 || !Number.isFinite(input.escalationPercent) || input.escalationPercent < 0) throw new Error('Enter valid billing, escalation, and renewal terms.');
  const requiredMonths: Record<BillingFrequency, number> = { monthly: 0, quarterly: 3, halfYearly: 2, annual: 1 };
  const months = [...new Set(input.invoiceMonths)].sort((a, b) => a - b);
  if (months.length !== requiredMonths[input.billingFrequency] || months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) throw new Error(`${input.billingFrequency === 'halfYearly' ? 'Half-yearly' : input.billingFrequency[0].toUpperCase() + input.billingFrequency.slice(1)} contracts require ${requiredMonths[input.billingFrequency]} invoice months.`);
}
function renewalStatusFor(contract: Contract, date = new Date()): RenewalStatus {
  const today = date.toISOString().slice(0, 10);
  if (contract.endDate < today) return 'expired';
  const noticeDate = new Date(`${contract.endDate}T00:00:00Z`);
  noticeDate.setUTCDate(noticeDate.getUTCDate() - contract.renewalNoticeDays);
  return noticeDate.toISOString().slice(0, 10) <= today ? 'upcoming' : 'current';
}
function renewalDueTiming(endDate: string, date = new Date()) {
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.round((end - today) / 86400000);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days} days`;
}

export function createContractMethods(database: DatabaseSync) {
  return {
    listContracts(session: AppSession, query: ContractQuery = {}): ContractList {
      requireTenantMember(session);
      const conditions = ['contracts.tenant_id = ?']; const values: Array<string | number> = [session.tenantId];
      if (query.search?.trim()) { conditions.push('(lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); values.push(`%${query.search.trim().toLowerCase()}%`, `%${query.search.trim().toLowerCase()}%`); }
      if (query.status) { conditions.push('contracts.status = ?'); values.push(query.status); }
      if (query.month) { conditions.push('substr(contracts.created_at, 1, 7) = ?'); values.push(query.month); }
      if (query.customerId) { conditions.push('contracts.customer_id = ?'); values.push(query.customerId); }
      const where = conditions.join(' AND '); const total = (database.prepare(`SELECT COUNT(*) AS count FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${where}`).get(...values) as { count: number }).count;
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      const rows = database.prepare(`SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${where} ORDER BY contracts.created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
      return { items: rows.map((row) => contractFromRow(database, row)), total };
    },
    createContract(session: AppSession, input: ContractInput): Contract {
      requireTenantMember(session); validateContractInput(input);
      const customer = database.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND status = \'active\'').get(input.customerId, session.tenantId);
      if (!customer) throw new Error('The selected customer must belong to your tenant and be active.');
      const services = [...new Set(input.serviceIds)]; const serviceStatement = database.prepare('SELECT id FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\'');
      if (services.some((serviceId) => !serviceStatement.get(serviceId, session.tenantId))) throw new Error('Each contract service must belong to your tenant and be active.');
      const id = `${session.tenantId}-contract-${crypto.randomUUID()}`; const timestamp = now();
      database.exec('BEGIN');
      try {
        database.prepare('INSERT INTO contracts (id, tenant_id, customer_id, name, start_date, end_date, value_minor, payment_terms_days, billing_frequency, invoice_months, cycle_day, escalation_percent, escalation_review_date, renewal_notice_days, security_deposit_minor, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)').run(id, session.tenantId, input.customerId, input.name.trim(), input.startDate, input.endDate, input.valueMinor, input.paymentTermsDays, input.billingFrequency, JSON.stringify([...new Set(input.invoiceMonths)].sort((a, b) => a - b)), input.cycleDay, input.escalationPercent, input.escalationReviewDate || null, input.renewalNoticeDays, input.securityDepositMinor, timestamp, timestamp);
        const insertService = database.prepare('INSERT INTO contract_services (contract_id, service_id) VALUES (?, ?)'); for (const serviceId of services) insertService.run(id, serviceId);
        database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), id, 'created', 'Contract created.', timestamp);
        if (input.securityDepositMinor > 0) database.prepare('INSERT INTO security_deposits (id, tenant_id, contract_id, customer_id, amount_minor, status, created_at) VALUES (?, ?, ?, ?, ?, \'held\', ?)').run(crypto.randomUUID(), session.tenantId, id, input.customerId, input.securityDepositMinor, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      const row = database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ?').get(id) as Record<string, unknown>;
      return contractFromRow(database, row);
    },
    updateContract(session: AppSession, contractId: string, update: ContractUpdate): Contract {
      requireTenantMember(session);
      const existing = database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.tenant_id = ?').get(contractId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('This contract does not belong to your tenant.');
      const current = contractFromRow(database, existing); const input: ContractInput = { customerId: update.customerId ?? current.customerId, serviceIds: update.serviceIds ?? current.serviceIds, name: update.name ?? current.name, startDate: update.startDate ?? current.startDate, endDate: update.endDate ?? current.endDate, valueMinor: update.valueMinor ?? current.valueMinor, paymentTermsDays: update.paymentTermsDays ?? current.paymentTermsDays, billingFrequency: update.billingFrequency ?? current.billingFrequency, invoiceMonths: update.invoiceMonths ?? current.invoiceMonths, cycleDay: update.cycleDay ?? current.cycleDay, escalationPercent: update.escalationPercent ?? current.escalationPercent, escalationReviewDate: update.escalationReviewDate ?? (current.escalationReviewDate ?? ''), renewalNoticeDays: update.renewalNoticeDays ?? current.renewalNoticeDays, securityDepositMinor: update.securityDepositMinor ?? current.securityDepositMinor };
      validateContractInput(input); const status = update.status ?? current.status; if (status !== 'active' && status !== 'inactive') throw new Error('Invalid contract status.');
      const customer = database.prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND status = \'active\'').get(input.customerId, session.tenantId); if (!customer) throw new Error('The selected customer must belong to your tenant and be active.');
      const services = [...new Set(input.serviceIds)]; const serviceStatement = database.prepare('SELECT id FROM services WHERE id = ? AND tenant_id = ? AND status = \'active\''); if (services.some((serviceId) => !serviceStatement.get(serviceId, session.tenantId))) throw new Error('Each contract service must belong to your tenant and be active.');
      const timestamp = now(); database.exec('BEGIN');
      try { database.prepare('UPDATE contracts SET customer_id=?, name=?, start_date=?, end_date=?, value_minor=?, payment_terms_days=?, billing_frequency=?, invoice_months=?, cycle_day=?, escalation_percent=?, escalation_review_date=?, renewal_notice_days=?, security_deposit_minor=?, status=?, updated_at=? WHERE id=? AND tenant_id=?').run(input.customerId, input.name.trim(), input.startDate, input.endDate, input.valueMinor, input.paymentTermsDays, input.billingFrequency, JSON.stringify([...new Set(input.invoiceMonths)].sort((a, b) => a - b)), input.cycleDay, input.escalationPercent, input.escalationReviewDate || null, input.renewalNoticeDays, input.securityDepositMinor, status, timestamp, contractId, session.tenantId); database.prepare('DELETE FROM contract_services WHERE contract_id = ?').run(contractId); const insertService = database.prepare('INSERT INTO contract_services (contract_id, service_id) VALUES (?, ?)'); for (const serviceId of services) insertService.run(contractId, serviceId); database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), contractId, 'updated', `Contract ${status}.`, timestamp); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      return contractFromRow(database, database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ?').get(contractId) as Record<string, unknown>);
    },
    listRenewals(session: AppSession, query: RenewalQuery = {}): RenewalList {
      requireTenantMember(session);
      const search = query.search?.trim().toLowerCase();
      const clauses = ['contracts.tenant_id = ?']; const values: string[] = [session.tenantId!];
      if (search) { clauses.push('(lower(contracts.name) LIKE ? OR lower(customers.company_name) LIKE ?)'); values.push(`%${search}%`, `%${search}%`); }
      const rows = database.prepare(`SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE ${clauses.join(' AND ')} ORDER BY contracts.created_at DESC`).all(...values) as Record<string, unknown>[];
      const contracts = rows.map((row) => contractFromRow(database, row));
      const records = contracts.map((contract): RenewalRecord => ({ contractId: contract.id, contractName: contract.name, customerName: contract.customerName, endDate: contract.endDate, valueMinor: contract.valueMinor, renewalNoticeDays: contract.renewalNoticeDays, renewalStatus: renewalStatusFor(contract), dueTiming: renewalDueTiming(contract.endDate), status: contract.status }));
      const filtered = records.filter((record) => (!query.status || record.renewalStatus === query.status) && (!query.month || record.endDate.startsWith(query.month)));
      const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100); const page = Math.max(query.page ?? 1, 1);
      return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
    },
    listContractAudit(session: AppSession, contractId: string): ContractAuditEvent[] {
      requireTenantMember(session);
      const owned = database.prepare('SELECT id FROM contracts WHERE id = ? AND tenant_id = ?').get(contractId, session.tenantId);
      if (!owned) throw new Error('This contract does not belong to your tenant.');
      return (database.prepare('SELECT id, action, detail, occurred_at FROM contract_audit_events WHERE contract_id = ? ORDER BY occurred_at DESC').all(contractId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), action: String(row.action), detail: String(row.detail), occurredAt: String(row.occurred_at) }));
    },
    renewContract(session: AppSession, contractId: string, input: { endDate: string; note: string }): Contract {
      requireTenantMember(session);
      const existing = database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ? AND contracts.tenant_id = ?').get(contractId, session.tenantId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error('This contract does not belong to your tenant.');
      const contract = contractFromRow(database, existing);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate <= contract.endDate) throw new Error('The renewed end date must be later than the current end date.');
      const timestamp = now(); const note = input.note.trim() || 'Renewal recorded.';
      database.exec('BEGIN');
      try {
        database.prepare('UPDATE contracts SET end_date = ?, status = \'active\', updated_at = ? WHERE id = ? AND tenant_id = ?').run(input.endDate, timestamp, contractId, session.tenantId);
        database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), contractId, 'renewed', note, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return contractFromRow(database, database.prepare('SELECT contracts.*, customers.company_name AS customer_name FROM contracts JOIN customers ON customers.id = contracts.customer_id WHERE contracts.id = ?').get(contractId) as Record<string, unknown>);
    },
    listSecurityDeposits(session: AppSession): SecurityDeposit[] {
      requireTenantMember(session); return (database.prepare('SELECT security_deposits.*, customers.company_name AS customer_name FROM security_deposits JOIN customers ON customers.id = security_deposits.customer_id WHERE security_deposits.tenant_id = ? ORDER BY security_deposits.created_at DESC').all(session.tenantId) as Record<string, unknown>[]).map((row) => { const amountMinor = Number(row.amount_minor); const settledMinor = Number(row.settled_minor); return { id: String(row.id), contractId: String(row.contract_id), customerId: String(row.customer_id), customerName: String(row.customer_name), amountMinor, settledMinor, balanceMinor: amountMinor - settledMinor, status: row.status as SecurityDeposit['status'], createdAt: String(row.created_at), settledAt: row.settled_at ? String(row.settled_at) : null, settlementNote: row.settlement_note ? String(row.settlement_note) : null }; });
    },
    settleSecurityDeposit(session: AppSession, depositId: string, input: DepositSettlementInput): SecurityDeposit {
      requireTenantMember(session);
      if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Settlement amount must be a positive whole minor-unit value.');
      const row = database.prepare('SELECT * FROM security_deposits WHERE id = ? AND tenant_id = ?').get(depositId, session.tenantId) as Record<string, unknown> | undefined;
      if (!row) throw new Error('This security deposit does not belong to your tenant.');
      const amountMinor = Number(row.amount_minor); const settledMinor = Number(row.settled_minor);
      if (settledMinor >= amountMinor || row.status === 'settled') throw new Error('This security deposit has already been settled.');
      if (input.amountMinor > amountMinor - settledMinor) throw new Error('Settlement cannot exceed the held deposit balance.');
      const totalSettled = settledMinor + input.amountMinor; const timestamp = now(); const isSettled = totalSettled === amountMinor;
      database.exec('BEGIN');
      try {
        database.prepare('INSERT INTO security_deposit_settlements (id, deposit_id, tenant_id, amount_minor, note, settled_at) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), depositId, session.tenantId, input.amountMinor, input.note.trim() || 'Customer closeout settlement.', timestamp);
        database.prepare('UPDATE security_deposits SET settled_minor = ?, settlement_note = ?, settled_at = ?, status = ? WHERE id = ? AND tenant_id = ?').run(totalSettled, input.note.trim() || 'Customer closeout settlement.', isSettled ? timestamp : null, isSettled ? 'settled' : 'held', depositId, session.tenantId);
        database.prepare('INSERT INTO contract_audit_events (id, contract_id, action, detail, occurred_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), String(row.contract_id), 'deposit-settled', `Security deposit settlement of ${input.amountMinor} recorded.`, timestamp);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return this.listSecurityDeposits(session).find((deposit) => deposit.id === depositId)!;
    },
  };
}
