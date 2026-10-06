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
    expect(store.listContracts(evo, {}).items).toEqual([]);
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
    const created = store.createCustomer(nexio, { companyName: 'Meridian Labs', contactName: 'Aarav Mehta', email: 'aarav@meridian.example', phone: '+91 98765 43210', gstin: '29ABCDE1234F1Z5', billingAddress: '18 Meridian Road', invoiceDelivery: 'monthly' });
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
      companyName: 'Nexio Billing Services', gstin: '29ABCDE1234F1Z5', address: '42 Ledger Lane, Bengaluru',
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
