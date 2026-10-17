import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { gstSalesCsv, hsnSummaryCsv } from '../gst-sales-export';
import type { InvoiceLineInput } from '../invoice-lines';
import { createTenantStore } from '../tenant-store';

const KARNATAKA = '29AAGCB7383J1Z4';
const MAHARASHTRA = '27AAPFU0939F1ZV';
const stores: Array<ReturnType<typeof createTenantStore>> = [];

function storeForTest() {
  const store = createTenantStore(':memory:');
  stores.push(store);
  return store;
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

function setup() {
  const store = storeForTest();
  const session = store.authenticate('nexio-admin');
  if (!session) throw new Error('Expected seeded session');
  const register = (gstin = KARNATAKA) => store.updateTenantSettings(session, { ...store.getTenantSettings(session), gstin, legalName: 'Nexio Hyper Private Limited' });
  const customer = (fields: { gstin?: string; stateCode?: string; name?: string } = {}) => store.createCustomer(session, { companyName: fields.name ?? `Buyer ${crypto.randomUUID()}`, contactName: 'Buyer', email: 'buyer@example.com', phone: '9000000000', gstin: fields.gstin ?? '', stateCode: fields.stateCode, billingAddress: 'Somewhere', invoiceDelivery: 'manual' });
  const line = (fields: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({ description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311', ...fields });
  const invoice = (customerId: string, lines: InvoiceLineInput[], extra: { taxSplitOverrideReason?: string; invoiceDate?: string } = {}) => store.createIssuedInvoice(session, { customerId, invoiceDate: extra.invoiceDate ?? '2026-11-02', dueDate: '2026-11-30', gstApplicable: true, lines, taxSplitOverrideReason: extra.taxSplitOverrideReason });
  return { store, session, register, customer, line, invoice };
}

describe('seller GST setup', () => {
  it('rejects an invalid GSTIN with a message that names the problem', () => {
    const { store, session } = setup();
    const settings = store.getTenantSettings(session);
    expect(() => store.updateTenantSettings(session, { ...settings, gstin: '29AAGCB7383J1Z5' })).toThrow(/check digit/);
    expect(() => store.updateTenantSettings(session, { ...settings, gstin: '29ABC' })).toThrow(/15 characters/);
    expect(store.getTenantSettings(session).gstin).toBe('');
  });

  it('stores a valid GSTIN in capitals with the legal name and the state taken from its first two digits', () => {
    const { register } = setup();
    const saved = register(KARNATAKA.toLowerCase());
    expect(saved).toMatchObject({ gstin: KARNATAKA, legalName: 'Nexio Hyper Private Limited', stateCode: '29' });
  });

  it('treats a blank GSTIN as unregistered and clears the state', () => {
    const { store, session, register } = setup();
    register();
    const saved = store.updateTenantSettings(session, { ...store.getTenantSettings(session), gstin: '  ' });
    expect(saved).toMatchObject({ gstin: '', stateCode: '' });
  });

  it('keeps the stored legal name when an update does not send one', () => {
    const { store, session, register } = setup();
    register();
    const { legalName, ...rest } = store.getTenantSettings(session);
    expect(legalName).toBe('Nexio Hyper Private Limited');
    expect(store.updateTenantSettings(session, { ...rest, footer: 'Updated footer' }).legalName).toBe('Nexio Hyper Private Limited');
  });
});

describe('client GST setup', () => {
  it('rejects an invalid client GSTIN on create and update', () => {
    const { store, session, customer } = setup();
    expect(() => customer({ gstin: '27AAPFU0939F1ZX' })).toThrow(/check digit/);
    const created = customer();
    expect(() => store.updateCustomer(session, created.id, { ...created, gstin: 'BADGSTIN' })).toThrow(/15 characters/);
  });

  it('sets the state code from a valid GSTIN and ignores a conflicting billing state', () => {
    const { customer } = setup();
    expect(customer({ gstin: MAHARASHTRA, stateCode: '29' })).toMatchObject({ gstin: MAHARASHTRA, stateCode: '27' });
  });

  it('lets an unregistered client carry a billing state and rejects an unknown one', () => {
    const { store, session, customer } = setup();
    const created = customer({ stateCode: '29' });
    expect(created).toMatchObject({ gstin: '', stateCode: '29' });
    expect(customer({}).stateCode).toBe('');
    expect(() => customer({ stateCode: '25' })).toThrow(/billing state/);
    const cleared = store.updateCustomer(session, created.id, { ...created, stateCode: '' });
    expect(cleared.stateCode).toBe('');
  });

  it('moves the stored state when a registered client is edited to a new GSTIN', () => {
    const { store, session, customer } = setup();
    const created = customer({ gstin: KARNATAKA });
    expect(created.stateCode).toBe('29');
    expect(store.updateCustomer(session, created.id, { ...created, gstin: MAHARASHTRA }).stateCode).toBe('27');
  });
});

describe('HSN/SAC on services', () => {
  it('validates, stores and updates the code on a service', () => {
    const { store, session } = setup();
    const prices = { monthly: 1000, quarterly: 2000, halfYearly: 3000, annual: 4000 };
    expect(() => store.createService(session, { name: 'Bad code', prices, hsnSac: '12' })).toThrow(/HSN\/SAC/);
    const service = store.createService(session, { name: 'Consulting', prices, hsnSac: '998311' });
    expect(service.hsnSac).toBe('998311');
    expect(store.createService(session, { name: 'No code', prices }).hsnSac).toBe('');
    expect(store.updateService(session, service.id, { hsnSac: '' }).hsnSac).toBe('');
    expect(() => store.updateService(session, service.id, { hsnSac: 'ABC' })).toThrow(/HSN\/SAC/);
  });
});

describe('place of supply and tax split', () => {
  it('preselects CGST + SGST inside the seller state and IGST outside it', () => {
    const { store, session, register, customer } = setup();
    register();
    expect(store.getSupplyContext(session, { customerId: customer({ stateCode: '29' }).id })).toMatchObject({ taxSplit: 'intra', expectedTaxType: 'cgst_sgst', sellerStateCode: '29' });
    expect(store.getSupplyContext(session, { customerId: customer({ gstin: MAHARASHTRA }).id })).toMatchObject({ taxSplit: 'inter', expectedTaxType: 'igst', placeOfSupplyStateCode: '27' });
    expect(store.getSupplyContext(session, { customerGstin: MAHARASHTRA })).toMatchObject({ taxSplit: 'inter' });
    expect(() => store.getSupplyContext(session, { customerGstin: '27AAPFU0939F1ZX' })).toThrow(/check digit/);
  });

  it('snapshots both states, the split and the document type on the issued invoice', () => {
    const { store, session, register, customer, line, invoice } = setup();
    register();
    const buyer = customer({ stateCode: '29' });
    const issued = invoice(buyer.id, [line()]);
    expect(issued.snapshot).toMatchObject({ documentType: 'Tax Invoice', sellerLegalName: 'Nexio Hyper Private Limited', sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra' });
    expect(issued.snapshot.taxSplitOverrideReason).toBeUndefined();

    store.updateCustomer(session, buyer.id, { ...buyer, stateCode: '27' });
    expect(store.getInvoice(session, issued.id)?.snapshot).toMatchObject({ placeOfSupplyStateCode: '29', taxSplit: 'intra' });
  });

  it('requires a reason to override the preselected split and stores it on the snapshot', () => {
    const { register, customer, line, invoice } = setup();
    register();
    const buyer = customer({ stateCode: '29' });
    expect(() => invoice(buyer.id, [line({ taxType: 'igst' })])).toThrow(/reason/);
    expect(() => invoice(buyer.id, [line({ taxType: 'igst' })], { taxSplitOverrideReason: '   ' })).toThrow(/reason/);
    const issued = invoice(buyer.id, [line({ taxType: 'igst' })], { taxSplitOverrideReason: 'Supply to an SEZ unit' });
    expect(issued.snapshot).toMatchObject({ taxSplit: 'intra', taxSplitOverrideReason: 'Supply to an SEZ unit' });
  });

  it('does not ask for a reason when the seller is unregistered', () => {
    const { customer, line, invoice } = setup();
    const issued = invoice(customer({ stateCode: '29' }).id, [line({ taxType: 'igst', hsnSac: '' })]);
    expect(issued.snapshot).toMatchObject({ documentType: 'Bill of Supply', sellerStateCode: '', placeOfSupplyStateCode: '29' });
    expect(issued.snapshot.taxSplit).toBeUndefined();
  });

  it('carries the override reason through an invoice correction', () => {
    const { store, session, register, customer, line, invoice } = setup();
    register();
    const buyer = customer({ stateCode: '29' });
    const original = invoice(buyer.id, [line()]);
    const input = { invoiceDate: '2026-11-02', dueDate: '2026-11-30', gstApplicable: true, lines: [line({ taxType: 'igst' })] };
    expect(() => store.correctInvoice(session, original.id, input, 'Wrong tax split')).toThrow(/reason/);
    expect(store.getInvoice(session, original.id)?.status).toBe('issued');
    const replacement = store.correctInvoice(session, original.id, { ...input, taxSplitOverrideReason: 'Supply to an SEZ unit' }, 'Wrong tax split');
    expect(replacement.snapshot.taxSplitOverrideReason).toBe('Supply to an SEZ unit');
  });
});

describe('document type', () => {
  it('issues a Bill of Supply when the seller is unregistered or nothing is taxable', () => {
    const { store, session, register, customer, line, invoice } = setup();
    expect(invoice(customer().id, [line({ taxType: 'none', gstRate: 0, hsnSac: '' })]).snapshot.documentType).toBe('Bill of Supply');
    register();
    expect(invoice(customer().id, [line({ taxType: 'none', gstRate: 0, hsnSac: '' })]).snapshot.documentType).toBe('Bill of Supply');
    expect(invoice(customer().id, [line()]).snapshot.documentType).toBe('Tax Invoice');
    expect(store.listInvoices(session, {}).items.find((item) => item.snapshot.documentType === undefined)).toBeTruthy();
  });

  it('allows an invoice to an unregistered client with GST charged and no client GSTIN', () => {
    const { register, customer, line, invoice } = setup();
    register();
    expect(invoice(customer({ stateCode: '29' }).id, [line()]).gstMinor).toBe(18_000);
  });

  it('marks bulk-generated invoices with the same snapshot fields', () => {
    const { store, session, register } = setup();
    register();
    store.generateBulkInvoices(session, '2026-11');
    const bulk = store.listInvoices(session, { month: '2026-11' }).items;
    expect(bulk.length).toBeGreaterThan(0);
    expect(bulk[0].snapshot).toMatchObject({ documentType: 'Tax Invoice', sellerStateCode: '29' });
  });
});

describe('HSN/SAC on invoice lines', () => {
  it('requires a valid code on taxable lines of a Tax Invoice and keeps it optional elsewhere', () => {
    const { register, customer, line, invoice } = setup();
    register();
    const buyer = customer({ stateCode: '29' });
    expect(() => invoice(buyer.id, [line({ hsnSac: '' })])).toThrow(/HSN\/SAC code/);
    expect(() => invoice(buyer.id, [line({ hsnSac: '12' })])).toThrow(/HSN\/SAC/);
    expect(invoice(buyer.id, [line(), line({ description: 'Gift', taxType: 'none', gstRate: 0, hsnSac: '' })]).snapshot.lines?.map((item) => item.hsnSac)).toEqual(['998311', '']);
    expect(invoice(buyer.id, [line({ taxType: 'none', gstRate: 0, hsnSac: '998311' })]).snapshot.lines?.[0].hsnSac).toBe('998311');
  });
});

describe('GSTR-1 export', () => {
  it('classifies each invoice into a section and summarises HSN/SAC codes', () => {
    const { store, session, register, customer, line, invoice } = setup();
    register();
    const registered = customer({ gstin: MAHARASHTRA, name: 'Registered Buyer' });
    const retail = customer({ stateCode: '29', name: 'Retail Buyer' });
    const largeRetail = customer({ stateCode: '27', name: 'Large Retail Buyer' });
    invoice(registered.id, [line({ taxType: 'igst', quantity: 2 })]);
    invoice(retail.id, [line({ quantity: 1, rateMinor: 50_000 })]);
    invoice(largeRetail.id, [line({ taxType: 'igst', rateMinor: 20_000_000 })]);
    invoice(retail.id, [line({ description: 'Exempt', taxType: 'none', gstRate: 0, hsnSac: '' })]);

    const report = store.getGstSalesReport(session, '2026-11');
    const sectionOf = (name: string) => report.items.filter((item) => item.customerName === name).map((item) => item.section);
    expect(sectionOf('Registered Buyer')).toEqual(['B2B']);
    expect(sectionOf('Retail Buyer')).toEqual(['B2CS', 'NIL_EXEMPT_NON_GST']);
    expect(sectionOf('Large Retail Buyer')).toEqual(['B2CL']);

    expect(report.hsnSummary).toEqual([{ hsn: '998311', description: 'Consulting', quantity: 4, taxableMinor: 20_250_000, taxMinor: 3_645_000 }]);
    const csv = gstSalesCsv(report);
    expect(csv.split('\r\n')[3]).toMatch(/"Net GST","Section"$/);
    expect(csv).toContain('"B2CL"');
    expect(hsnSummaryCsv(report).split('\r\n')[3]).toBe('"HSN/SAC","Description","Quantity","Taxable value","Tax"');
  });
});

describe('additive migration', () => {
  it('upgrades the shipped seed database in place without losing a row', () => {
    const directory = mkdtempSync(join(tmpdir(), 'client-billing-gst-migration-'));
    const filename = join(directory, 'legacy.sqlite');
    const previousSeedMode = process.env.CLIENT_BILLING_SEED_MODE;
    delete process.env.CLIENT_BILLING_SEED_MODE;
    try {
      const legacy = new DatabaseSync(filename);
      legacy.exec("CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
      legacy.exec("CREATE TABLE customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, gstin TEXT NOT NULL, billing_address TEXT NOT NULL, invoice_delivery TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      legacy.exec("CREATE TABLE tenant_settings (tenant_id TEXT PRIMARY KEY, company_name TEXT NOT NULL, gstin TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', invoice_prefix TEXT NOT NULL, payment_terms_days INTEGER NOT NULL, footer TEXT NOT NULL DEFAULT '', invoice_template TEXT NOT NULL, email_subject TEXT NOT NULL, email_body TEXT NOT NULL, smtp_host TEXT NOT NULL DEFAULT '', smtp_port INTEGER NOT NULL DEFAULT 587, smtp_from TEXT NOT NULL DEFAULT '', log_retention_days INTEGER NOT NULL DEFAULT 30, logo_data_url TEXT NOT NULL DEFAULT '', stamp_data_url TEXT NOT NULL DEFAULT '', signature_data_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)");
      legacy.exec("CREATE TABLE services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, monthly_minor INTEGER NOT NULL, quarterly_minor INTEGER NOT NULL, half_yearly_minor INTEGER NOT NULL, annual_minor INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, name))");
      legacy.exec("INSERT INTO tenants (id, name, status) VALUES ('legacy', 'Legacy Co', 'active')");
      const insertCustomer = legacy.prepare("INSERT INTO customers VALUES (?, 'legacy', ?, 'C', 'c@example.com', '1', ?, 'Addr', 'manual', 'active', 't', 't')");
      insertCustomer.run('c-valid', 'Valid', MAHARASHTRA); insertCustomer.run('c-junk', 'Junk', 'NA'); insertCustomer.run('c-blank', 'Blank', '');
      legacy.exec(`INSERT INTO tenant_settings (tenant_id, company_name, gstin, invoice_prefix, payment_terms_days, invoice_template, email_subject, email_body, updated_at) VALUES ('legacy', 'Legacy Co', '${KARNATAKA}', 'LEG', 14, 't', 's', 'b', 't')`);
      legacy.exec("INSERT INTO services (id, tenant_id, name, status, monthly_minor, quarterly_minor, half_yearly_minor, annual_minor, created_at, updated_at) VALUES ('svc', 'legacy', 'Old service', 'active', 1, 2, 3, 4, 't', 't')");
      legacy.close();

      for (let open = 0; open < 2; open += 1) {
        const store = createTenantStore(filename);
        const session = { id: 'legacy-admin', name: 'A', email: 'a@example.com', role: 'admin' as const, tenantId: 'legacy', tenantName: 'Legacy Co' };
        const customers = store.listCustomers(session, {}).items;
        expect(customers.map((item) => [item.id, item.gstin, item.stateCode]).sort()).toEqual([['c-blank', '', ''], ['c-junk', 'NA', ''], ['c-valid', MAHARASHTRA, '27']]);
        expect(store.getTenantSettings(session)).toMatchObject({ gstin: KARNATAKA, stateCode: '29', legalName: '' });
        expect(store.listServices(session)).toEqual([expect.objectContaining({ id: 'svc', hsnSac: '' })]);
        store.close();
      }
    } finally {
      if (previousSeedMode === undefined) delete process.env.CLIENT_BILLING_SEED_MODE;
      else process.env.CLIENT_BILLING_SEED_MODE = previousSeedMode;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
