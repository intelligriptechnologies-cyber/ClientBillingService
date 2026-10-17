import { afterEach, describe, expect, it } from 'vitest';
import { createTenantStore } from './tenant-store';

const stores: Array<ReturnType<typeof createTenantStore>> = [];

function storeForTest() {
  const store = createTenantStore(':memory:');
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('tenant lifecycle', () => {
  it('lets the superadmin create, change, and disable a tenant while retaining lifecycle history', () => {
    const store = storeForTest();
    const superadmin = store.authenticate('superadmin');
    if (!superadmin) throw new Error('Expected superadmin session');

    const created = store.createTenant(superadmin, { name: 'Northstar Studio' });

    expect(created).toMatchObject({ name: 'Northstar Studio', status: 'active' });
    expect(store.listIdentities().filter((identity) => identity.tenantId === created.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin', tenantName: 'Northstar Studio' }),
      expect.objectContaining({ role: 'user', tenantName: 'Northstar Studio' }),
    ]));

    const updated = store.updateTenant(superadmin, created.id, { name: 'Northstar Creative', status: 'disabled' });
    expect(updated).toMatchObject({ id: created.id, name: 'Northstar Creative', status: 'disabled' });
    expect(store.authenticate(`${created.id}-admin`)).toBeNull();
    expect(store.listTenantHistory(superadmin, created.id).map((event) => event.action)).toEqual(['created', 'updated', 'disabled']);
  });

  it('does not expose tenant lifecycle operations to a tenant session', () => {
    const store = storeForTest();
    const tenantAdmin = store.authenticate('nexio-admin');
    if (!tenantAdmin) throw new Error('Expected tenant admin session');

    expect(() => store.listTenants(tenantAdmin, {})).toThrow('superadmin');
    expect(() => store.createTenant(tenantAdmin, { name: 'Not allowed' })).toThrow('superadmin');
  });
});

describe('tenant store', () => {
  it('persists row-wise GST, billing details and corrected line items', () => {
    const store = storeForTest(); const session = store.authenticate('nexio-admin');
    if (!session) throw new Error('Expected tenant session');
    const customer = store.listCustomers(session).items[0];
    const details = { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', venue: 'Bengaluru', billingAddress: 'New billing address', customerPan: 'ABCDE1234F', customerGstin: '29AAGCB7383J1Z4', gstApplicable: true, notes: 'Monthly booking' };
    const first = store.createIssuedInvoice(session, { ...details, lines: [
      { description: 'Venue booking', quantity: 2, rateMinor: 12500, taxType: 'igst', gstRate: 18 },
      { description: 'Security deposit', quantity: 1, rateMinor: 5000, taxType: 'none', gstRate: 0 },
    ] });
    expect(first).toMatchObject({ taxableMinor: 30000, gstMinor: 4500, totalMinor: 34500, snapshot: { venue: 'Bengaluru', customerAddress: 'New billing address', notes: 'Monthly booking', lines: [{ amountMinor: 25000, gstMinor: 4500 }, { amountMinor: 5000, gstMinor: 0 }] } });
    expect(store.getGstSalesReport(session, '2026-10').items.find((row) => row.invoiceId === first.id)).toMatchObject({ igstMinor: 4500, cgstMinor: 0, sgstMinor: 0 });
    const corrected = store.correctInvoice(session, first.id, { ...details, lines: [{ description: 'Revised booking', quantity: 1, rateMinor: 20000, taxType: 'cgst_sgst', gstRate: 12 }] }, 'Reduced booking');
    expect(corrected).toMatchObject({ taxableMinor: 20000, gstMinor: 2400, totalMinor: 22400, snapshot: { lines: [{ description: 'Revised booking', taxType: 'cgst_sgst' }] } });
    expect(store.getGstSalesReport(session, '2026-10').items.find((row) => row.invoiceId === corrected.id)).toMatchObject({ igstMinor: 0, cgstMinor: 1200, sgstMinor: 1200 });
    expect(store.getInvoice(session, first.id)?.status).toBe('void');
    expect(() => store.createIssuedInvoice(session, { ...details, lines: [{ description: 'Invalid', quantity: 1, rateMinor: 100, taxType: 'none', gstRate: 18 }] })).toThrow('valid GST');
  });
  it('edits and archives a draft quotation without changing another tenant', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected tenant sessions');
    const service = store.listServices(nexio).find((item) => item.status === 'active');
    if (!service) throw new Error('Expected active service');
    const quote = store.createQuotation(nexio, { customerName: 'First customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] });
    expect(store.updateQuotation(nexio, quote.id, { customerName: 'Updated customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 2 }] }).totalMinor).toBe(service.prices.monthly * 2);
    expect(store.updateQuotation(nexio, quote.id, { status: 'archived' }).status).toBe('archived');
    expect(store.listQuotations(nexio).find((item) => item.id === quote.id)?.status).toBe('archived');
    expect(() => store.updateQuotation(evo, quote.id, { status: 'draft' })).toThrow('does not belong');
  });

  it('voids an unpaid invoice with a reason and records operation errors for tenant admins', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected tenant session');
    const customer = store.listCustomers(nexio).items[0];
    const invoice = store.createIssuedInvoice(nexio, { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 10000 });
    expect(() => store.voidInvoice(nexio, invoice.id, '')).toThrow('reason');
    expect(store.voidInvoice(nexio, invoice.id, 'Issued in error').status).toBe('void');
    expect(() => store.voidInvoice(nexio, invoice.id, 'Again')).toThrow('already void');
    store.recordOperationalError(nexio, 'Test operation', new Error('Test failure'));
    expect(store.listOperationalLogs(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'error', message: expect.stringContaining('Test failure') })]));
  });

  it('corrects an unpaid invoice by replacing it and edits payment details without changing allocations', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected tenant session');
    const customer = store.listCustomers(nexio).items[0];
    const original = store.createIssuedInvoice(nexio, { customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-10-21', taxableMinor: 10000, gstRate: 18 });
    const corrected = store.correctInvoice(nexio, original.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Corrected price');
    expect(corrected.id).not.toBe(original.id);
    expect(corrected.taxableMinor).toBe(12000);
    expect(store.getInvoice(nexio, original.id)?.status).toBe('void');
    const payment = store.recordPayment(nexio, { invoiceId: corrected.id, paymentDate: '2026-10-08', amountMinor: 5000, tdsMinor: 0, writeOffMinor: 0, method: 'bank_transfer', reference: 'OLD', notes: '' });
    const edited = store.updatePaymentDetails(nexio, payment.id, { method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect(edited).toMatchObject({ appliedMinor: 5000, method: 'cheque', reference: 'NEW', notes: 'Reconciled' });
    expect(store.getInvoice(nexio, corrected.id)?.paidMinor).toBe(5000);
    expect(() => store.correctInvoice(nexio, corrected.id, { invoiceDate: '2026-10-07', dueDate: '2026-10-24', taxableMinor: 12000, gstRate: 18 }, 'Again')).toThrow('payments');
  });
  it('creates, filters, edits, and deletes task notes within the tenant', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected tenant sessions');
    const nexioCustomer = store.listCustomers(nexio).items[0]; const evoCustomer = store.listCustomers(evo).items[0];
    const input = { customerId: nexioCustomer.id, date: '2026-10-07', note: 'Call customer about renewal' };
    expect(() => store.createTaskNote(nexio, { ...input, customerId: evoCustomer.id })).toThrow('does not belong');
    expect(() => store.createTaskNote(nexio, { ...input, date: '2026-02-30' })).toThrow('valid date');
    const created = store.createTaskNote(nexio, input);
    expect(store.listTaskNotes(nexio, { date: input.date, customerId: nexioCustomer.id })).toMatchObject([created]);
    expect(store.listTaskNotes(nexio, { date: '2026-10-08' })).toEqual([]);
    expect(store.listTaskNotes(evo)).toEqual([]);
    expect(() => store.updateTaskNote(evo, created.id, { ...input, customerId: evoCustomer.id, note: 'Changed' })).toThrow('not found');
    expect(() => store.updateTaskNote(nexio, created.id, { ...input, customerId: evoCustomer.id })).toThrow('does not belong');
    expect(store.updateTaskNote(nexio, created.id, { ...input, note: 'Followed up' }).note).toBe('Followed up');
    expect(() => store.deleteTaskNote(evo, created.id)).toThrow('not found');
    store.deleteTaskNote(nexio, created.id);
    expect(store.listTaskNotes(nexio)).toEqual([]);
  });
  it('previews a period billing run with additional services, explains skips, and issues it only once', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');
    const customer = store.listCustomers(nexio, {}).items[0];
    const service = store.listServices(nexio)[0];
    if (!customer || !service) throw new Error('Expected seeded customer and service');

    const eligible = store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'October managed billing', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'January-only annual billing', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'annual', invoiceMonths: [1], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    store.createAdditionalService(nexio, { customerId: customer.id, contractId: eligible.id, serviceDate: '2026-10-15', description: 'On-site workshop', priceMinor: 25000, notes: '' });

    const preview = store.previewBulkInvoices(nexio, '2026-10');
    expect(preview.proposed).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, additionalLines: [expect.objectContaining({ description: 'On-site workshop', priceMinor: 25000 })] })]));
    expect(preview.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'Billing is not scheduled for October.' })]));

    const first = store.generateBulkInvoices(nexio, '2026-10');
    expect(first).toMatchObject({ alreadyGenerated: false, generatedCount: 1 });
    expect(store.listInvoices(nexio, { month: '2026-10' }).items).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: eligible.id, taxableMinor: 125000, gstMinor: 22500 })]));
    expect(store.listAdditionalServices(nexio, { billingPeriod: '2026-10' }).items).toEqual([expect.objectContaining({ description: 'On-site workshop', billedAt: expect.any(String) })]);
    expect(store.listBulkInvoiceRuns(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ billingPeriod: '2026-10', generatedCount: 1 })]));

    expect(store.generateBulkInvoices(nexio, '2026-10')).toMatchObject({ alreadyGenerated: true, generatedCount: 1 });
    expect(store.listInvoices(nexio, { month: '2026-10' }).items.filter((invoice) => invoice.contractId === eligible.id)).toHaveLength(1);
  });

  it('allocates manual payments with TDS and write-off without exceeding an invoice balance', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = store.listInvoices(nexio, {}).items[0];
    const payment = store.recordPayment(nexio, { invoiceId: invoice.id, paymentDate: '2026-10-07', amountMinor: 100000, tdsMinor: 10000, writeOffMinor: 8000, method: 'bank_transfer', reference: 'UTR-2042', notes: 'Reconciled with customer.' });
    expect(payment).toMatchObject({ invoiceId: invoice.id, appliedMinor: 118000, reference: 'UTR-2042' });
    expect(store.getInvoice(nexio, invoice.id)).toMatchObject({ paidMinor: 118000, status: 'paid' });
    expect(store.listPayments(nexio, { month: '2026-10' }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: payment.id, customerId: invoice.customerId })]));
    expect(() => store.recordPayment(nexio, { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).toThrow('outstanding');
    expect(() => store.recordPayment(evo, { invoiceId: invoice.id, paymentDate: '2026-10-08', amountMinor: 1, tdsMinor: 0, writeOffMinor: 0, method: 'cash' })).toThrow('tenant');
  });

  it('lists aging pending invoices and records demo-only reminder history', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');
    const invoice = store.listInvoices(nexio, {}).items[0];
    const pending = store.listPendingPayments(nexio);
    expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({ id: invoice.id, outstandingMinor: invoice.totalMinor, agingBucket: expect.any(String) })]));
    const reminder = store.recordPaymentReminder(nexio, invoice.id, { channel: 'whatsapp', note: 'Please confirm payment date.' });
    expect(reminder).toMatchObject({ invoiceId: invoice.id, channel: 'whatsapp' });
    expect(store.listPendingPayments(nexio).find((item) => item.id === invoice.id)?.reminders).toEqual(expect.arrayContaining([expect.objectContaining({ id: reminder.id, channel: 'whatsapp' })]));
  });
  it('returns a tenant-scoped GST sales report with interstate and intrastate tax splits', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    store.updateTenantSettings(nexio, { ...store.getTenantSettings(nexio), gstin: '29AAGCB7383J1Z4' });
    const customer = store.listCustomers(nexio, {}).items[0];
    const interstate = store.createCustomer(nexio, { companyName: 'Interstate Buyer', contactName: 'Ravi', email: 'ravi@example.com', phone: '9000000000', gstin: '27AAPFU0939F1ZV', billingAddress: 'Mumbai', invoiceDelivery: 'email' });
    store.createIssuedInvoice(nexio, { customerId: customer.id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 10_000, gstRate: 18 });
    store.createIssuedInvoice(nexio, { customerId: interstate.id, invoiceDate: '2026-11-03', dueDate: '2026-11-17', taxableMinor: 20_000, gstRate: 18 });

    const report = store.getGstSalesReport(nexio, '2026-11');

    expect(report).toMatchObject({ month: '2026-11', companyName: 'Nexio Hyper', gstin: '29AAGCB7383J1Z4', totals: { taxableMinor: 30_000, gstMinor: 5_400, totalMinor: 35_400, igstMinor: 3_600, cgstMinor: 900, sgstMinor: 900, netGstMinor: 5_400 } });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ customerName: customer.companyName, cgstMinor: 900, sgstMinor: 900, igstMinor: 0 }),
      expect.objectContaining({ customerName: 'Interstate Buyer', igstMinor: 3_600, cgstMinor: 0, sgstMinor: 0 }),
    ]));
    expect(store.getGstSalesReport(evo, '2026-11').items).toEqual([]);
  });
  it('keeps issued invoice snapshots stable, supports filters, and isolates invoices by tenant', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = store.listCustomers(nexio, {}).items[0];
    const contract = store.createContract(nexio, {
      customerId: customer.id, serviceIds: [store.listServices(nexio)[0].id], name: 'Snapshot contract', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 250000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });
    const issued = store.createIssuedInvoice(nexio, { contractId: contract.id, invoiceDate: '2026-10-01', dueDate: '2026-10-15', taxableMinor: 250000, gstRate: 18 });
    expect(store.listInvoices(nexio, { month: '2026-10', search: customer.companyName }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id, customerName: customer.companyName, status: 'issued' })]));
    expect(store.listInvoices(evo, {}).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: issued.id })]));
    store.updateTenantSettings(nexio, { ...store.getTenantSettings(nexio), companyName: 'Changed company', invoicePrefix: 'NEW' });
    expect(store.getInvoice(nexio, issued.id)).toMatchObject({ invoiceNumber: expect.stringContaining('NEX'), snapshot: expect.objectContaining({ companyName: 'Nexio Hyper', customerName: customer.companyName, gstRate: 18 }) });
    expect(() => store.getInvoice(evo, issued.id)).toThrow('tenant');
  });

  it('records a dated additional service only against its customer contract and exposes it for that billing period', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = store.listCustomers(nexio, {}).items[0];
    const service = store.listServices(nexio)[0];
    if (!customer || !service) throw new Error('Expected seeded billing data');
    const contract = store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'Managed reporting', startDate: '2026-01-01', endDate: '2026-12-31',
      valueMinor: 120000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 1,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0,
    });

    const additional = store.createAdditionalService(nexio, { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'On-site reporting workshop', priceMinor: 250000, notes: 'Approved by finance.' });

    expect(store.listAdditionalServices(nexio, { billingPeriod: '2026-10' }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id, contractId: contract.id, priceMinor: 250000 })]));
    expect(store.listAdditionalServices(nexio, { billingPeriod: '2026-11' }).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: additional.id })]));
    expect(store.listAdditionalServices(evo, {}).items).toEqual([]);
    expect(() => store.createAdditionalService(evo, { customerId: customer.id, contractId: contract.id, serviceDate: '2026-10-15', description: 'Cross tenant', priceMinor: 100, notes: '' })).toThrow('tenant');
  });
  it('creates a tenant-scoped quarterly contract with its opening security deposit', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = store.listCustomers(nexio, {}).items[0];
    const service = store.createService(nexio, { name: 'Analytics support', prices: { monthly: 100000, quarterly: 280000, halfYearly: 540000, annual: 1000000 } });
    if (!customer) throw new Error('Expected seeded customer');

    const contract = store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'FY26 analytics support', startDate: '2026-04-01', endDate: '2027-03-31',
      valueMinor: 1200000, paymentTermsDays: 14, billingFrequency: 'quarterly', invoiceMonths: [4, 7, 10], cycleDay: 5,
      escalationPercent: 8, escalationReviewDate: '2027-04-01', renewalNoticeDays: 45, securityDepositMinor: 250000,
    });

    expect(contract).toMatchObject({ customerId: customer.id, billingFrequency: 'quarterly', invoiceMonths: [4, 7, 10], status: 'active' });
    expect(store.listSecurityDeposits(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ contractId: contract.id, amountMinor: 250000, status: 'held' })]));
    expect(store.listContracts(evo, {}).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: contract.id })]));
  });

  it('tracks renewals and settles a held deposit once without crossing tenant boundaries', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = store.listCustomers(nexio, {}).items[0];
    const service = store.listServices(nexio)[0];
    if (!customer || !service) throw new Error('Expected seeded customer and service');
    const contract = store.createContract(nexio, {
      customerId: customer.id, serviceIds: [service.id], name: 'Renewal and deposit contract', startDate: '2025-01-01', endDate: '2026-10-01',
      valueMinor: 1200000, paymentTermsDays: 14, billingFrequency: 'monthly', invoiceMonths: [], cycleDay: 5,
      escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 45, securityDepositMinor: 250000,
    });

    expect(store.listRenewals(nexio, { status: 'expired' }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ contractId: contract.id, renewalStatus: 'expired' }),
    ]));
    const renewed = store.renewContract(nexio, contract.id, { endDate: '2027-10-01', note: 'Customer confirmed another year.' });
    expect(renewed.endDate).toBe('2027-10-01');
    expect(store.listContractAudit(nexio, contract.id).map((event) => event.action)).toContain('renewed');

    const deposit = store.listSecurityDeposits(nexio).find((item) => item.contractId === contract.id);
    if (!deposit) throw new Error('Expected opening deposit');
    expect(store.settleSecurityDeposit(nexio, deposit.id, { amountMinor: 250000, note: 'Customer closeout refund.' })).toMatchObject({ status: 'settled', settledMinor: 250000 });
    expect(() => store.settleSecurityDeposit(nexio, deposit.id, { amountMinor: 1, note: 'Duplicate' })).toThrow('already been settled');
    expect(() => store.settleSecurityDeposit(evo, deposit.id, { amountMinor: 250000, note: 'Cross-tenant' })).toThrow('tenant');
  });

  it('rejects an invalid invoice-month schedule and cross-tenant contract references', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const customer = store.listCustomers(nexio, {}).items[0];
    const service = store.createService(nexio, { name: 'Analytics support', prices: { monthly: 100000, quarterly: 280000, halfYearly: 540000, annual: 1000000 } });
    if (!customer) throw new Error('Expected seeded customer');
    const input = { customerId: customer.id, serviceIds: [service.id], name: 'Invalid schedule', startDate: '2026-04-01', endDate: '2027-03-31', valueMinor: 100000, paymentTermsDays: 14, billingFrequency: 'quarterly' as const, invoiceMonths: [4, 7], cycleDay: 1, escalationPercent: 0, escalationReviewDate: '', renewalNoticeDays: 30, securityDepositMinor: 0 };
    expect(() => store.createContract(nexio, input)).toThrow('3 invoice months');
    expect(() => store.createContract(evo, { ...input, invoiceMonths: [4, 7, 10] })).toThrow('customer');
  });
  it('closes an outstanding tenant invoice with an auditable write-off allocation', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const invoice = store.listPendingPayments(nexio)[0];
    if (!invoice) throw new Error('Expected an outstanding invoice');
    const payment = store.closeInvoice(nexio, invoice.id, 'Approved closeout');
    expect(payment).toMatchObject({ invoiceId: invoice.id, amountMinor: 0, writeOffMinor: invoice.outstandingMinor, reference: 'CLOSEOUT' });
    expect(store.listPendingPayments(nexio).map((item) => item.id)).not.toContain(invoice.id);
    expect(store.listOperationalLogs(nexio).some((log) => log.message.includes(`Invoice ${invoice.invoiceNumber} was closed`))).toBe(true);
    expect(() => store.closeInvoice(evo, invoice.id)).toThrow('tenant');
  });

  it('seeds five tenants and two tenant-local users for each tenant', () => {
    const store = storeForTest();

    const identities = store.listIdentities();

    expect(identities.filter((identity) => identity.role !== 'superadmin')).toHaveLength(10);
    expect(new Set(identities.filter((identity) => identity.tenantId).map((identity) => identity.tenantId))).toHaveLength(5);
    expect(identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'Admin@nexio.com', role: 'admin', tenantName: 'Nexio Hyper' }),
      expect.objectContaining({ email: 'user@od.com', role: 'user', tenantName: 'OD Badminton' }),
    ]));
  });

  it('seeds a complete billing scenario for every tenant', () => {
    const store = storeForTest();

    for (const tenantId of ['nexio', 'maasp', 'evo', 'gripdata', 'od']) {
      const session = store.authenticate(`${tenantId}-admin`);
      if (!session) throw new Error(`Expected ${tenantId} admin session`);

      const customer = store.listCustomers(session, {}).items[0];
      const contract = store.listContracts(session, {}).items[0];
      const invoices = store.listInvoices(session, {}).items;
      const payments = store.listPayments(session, {}).items;
      const deposits = store.listSecurityDeposits(session);

      expect(customer).toBeDefined();
      expect(contract).toMatchObject({ customerId: customer?.id, status: 'active' });
      expect(invoices).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractId: contract?.id, customerId: customer?.id }),
      ]));
      expect(payments).toEqual(expect.arrayContaining([
        expect.objectContaining({ customerId: customer?.id, invoiceId: expect.any(String) }),
      ]));
      expect(deposits).toEqual(expect.arrayContaining([
        expect.objectContaining({ contractId: contract?.id, customerId: customer?.id, status: 'held' }),
      ]));
    }
  });

  it('does not permit a tenant session to read or write another tenant’s records', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    expect(store.listTenantRecords(nexio).map((record) => record.tenantId)).toEqual([nexio.tenantId]);
    expect(() => store.createTenantRecord(nexio, evo.tenantId!, 'Not allowed')).toThrow('tenant');
  });

  it('lets a tenant admin manage only its own users', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const created = store.createTenantUser(nexio, { name: 'Nexio Accounts', email: 'accounts@nexio.com', role: 'user' });

    expect(store.listTenantUsers(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, role: 'user', status: 'active' })]));
    expect(store.listTenantUsers(evo).map((user) => user.email)).not.toContain('accounts@nexio.com');
    expect(store.authenticate(created.id)).toEqual(expect.objectContaining({ role: 'user', tenantId: 'nexio' }));
  });

  it('persists an admin role and disabled status for the next soft-login session', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    if (!nexio) throw new Error('Expected seeded session');

    store.updateTenantUser(nexio, 'nexio-user', { role: 'admin', status: 'disabled' });

    expect(store.listTenantUsers(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'nexio-user', role: 'admin', status: 'disabled' })]));
    expect(store.authenticate('nexio-user')).toBeNull();
  });

  it('rejects user-manager actions from tenant users and cross-tenant targets', () => {
    const store = storeForTest();
    const nexioAdmin = store.authenticate('nexio-admin');
    const nexioUser = store.authenticate('nexio-user');
    if (!nexioAdmin || !nexioUser) throw new Error('Expected seeded sessions');

    expect(() => store.listTenantUsers(nexioUser)).toThrow('admin');
    expect(() => store.updateTenantUser(nexioAdmin, 'evo-user', { status: 'disabled' })).toThrow('tenant');
  });

  it('persists frequency-aware services and tenant-scoped quotations', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');

    const service = store.createService(nexio, {
      name: 'Managed analytics',
      description: 'Monthly reporting and advisory',
      prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 },
    });
    const quotation = store.createQuotation(nexio, {
      customerName: 'Acme Trading',
      customerEmail: 'accounts@acme.example',
      lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 2 }],
    });

    expect(store.listServices(nexio)).toEqual(expect.arrayContaining([expect.objectContaining({ id: service.id, prices: { monthly: 150000, quarterly: 420000, halfYearly: 780000, annual: 1440000 } })]));
    expect(quotation).toMatchObject({ customerName: 'Acme Trading', totalMinor: 300000, lines: [expect.objectContaining({ serviceName: 'Managed analytics', unitPriceMinor: 150000 })] });
    expect(store.listQuotations(evo)).toEqual([]);
    expect(() => store.getQuotation(evo, quotation.id)).toThrow('tenant');
  });

  it('rejects invalid service prices and quotation lines from another tenant', () => {
    const store = storeForTest();
    const nexio = store.authenticate('nexio-admin');
    const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const service = store.createService(nexio, { name: 'Reporting', prices: { monthly: 1000, quarterly: 0, halfYearly: 0, annual: 0 } });

    expect(() => store.createService(nexio, { name: 'Broken', prices: { monthly: -1, quarterly: 0, halfYearly: 0, annual: 0 } })).toThrow('non-negative');
    expect(() => store.createQuotation(evo, { customerName: 'Other customer', lines: [{ serviceId: service.id, frequency: 'monthly', quantity: 1 }] })).toThrow('tenant');
  });

  it('creates, filters, changes status, and scopes customers to the active tenant', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const created = store.createCustomer(nexio, { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29AAGCB7383J1Z4', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
    expect(store.listCustomers(nexio, { search: 'meridian' }).items).toEqual([expect.objectContaining({ id: created.id })]);
    expect(store.listCustomers(evo, { search: 'meridian' }).total).toBe(0);
    store.setCustomerStatus(nexio, created.id, 'inactive');
    expect(store.listCustomers(nexio, { status: 'active' }).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    expect(store.listCustomers(nexio, { status: 'inactive' }).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
  });

  it('rejects incomplete or invalid customer profiles', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); if (!nexio) throw new Error('Expected seeded session');
    expect(() => store.createCustomer(nexio, { companyName: '', contactName: '', email: 'not-email', phone: '', gstin: '', billingAddress: '', invoiceDelivery: 'monthly' })).toThrow('Company name');
  });

  it('persists complete tenant settings, template previews, and isolated operational logs', () => {
    const store = storeForTest(); const nexio = store.authenticate('nexio-admin'); const evo = store.authenticate('evo-admin');
    if (!nexio || !evo) throw new Error('Expected seeded sessions');
    const saved = store.updateTenantSettings(nexio, {
      companyName: 'Nexio Billing Services', gstin: '29AAGCB7383J1Z4', address: '42 Ledger Lane, Bengaluru',
      invoicePrefix: 'NX', paymentTermsDays: 21, footer: 'Thank you for your business.',
      invoiceTemplate: 'Invoice {{invoiceNumber}} for {{customerName}}', emailSubject: 'Your invoice {{invoiceNumber}}',
      emailBody: 'Hello {{customerName}}, please find your invoice attached.', smtpHost: 'smtp.demo.local', smtpPort: 2525,
      smtpFrom: 'billing@nexio.example', logRetentionDays: 30, logoDataUrl: 'data:image/png;base64,logo', stampDataUrl: '', signatureDataUrl: 'data:image/png;base64,signature',
    });

    expect(saved.companyName).toBe('Nexio Billing Services');
    expect(store.getTenantSettings(nexio)).toMatchObject({ invoicePrefix: 'NX', logoDataUrl: 'data:image/png;base64,logo' });
    expect(store.previewTenantTemplate(nexio)).toContain('Invoice NX-2026-001 for Acme Industries');
    expect(store.testTenantSmtp(nexio)).toContain('SMTP test prepared');
    expect(store.listOperationalLogs(nexio).some((log) => log.kind === 'feature-flow')).toBe(true);
    expect(store.listOperationalLogs(evo)).toEqual([]);
  });

  it('keeps settings and operational logs restricted to tenant admins', () => {
    const store = storeForTest();
    const tenantUser = store.authenticate('nexio-user');
    if (!tenantUser) throw new Error('Expected seeded session');

    expect(() => store.getTenantSettings(tenantUser)).toThrow('admin');
    expect(() => store.listOperationalLogs(tenantUser)).toThrow('admin');
  });
});
