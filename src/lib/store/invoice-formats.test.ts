import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION } from '../invoice-format';
import { renderInvoiceHtml } from '../invoice-html';
import { createTenantStore } from '../tenant-store';

const SELLER_GSTIN = '29AAGCB7383J1Z4';
const stores: Array<ReturnType<typeof createTenantStore>> = [];
const folders: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function setup() {
  const store = createTenantStore(':memory:');
  stores.push(store);
  const admin = store.authenticate('nexio-admin')!;
  const member = store.authenticate('nexio-user')!;
  const other = store.authenticate('evo-admin')!;
  store.updateTenantSettings(admin, { ...store.getTenantSettings(admin), gstin: SELLER_GSTIN, legalName: 'Nexio Private Limited' });
  const customerId = store.listCustomers(admin).items[0].id;
  const definition = (patch: Record<string, unknown> = {}) => ({ ...BUILTIN_DEFINITION, ...patch });
  const issue = (formatId?: string, session = admin) => store.createIssuedInvoice(session, { customerId, formatId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] });
  return { store, admin, member, other, customerId, definition, issue };
}

describe('tenant invoice formats', () => {
  it('gives every tenant a Standard default that matches what invoices printed before formats', () => {
    const { store, admin, other } = setup();
    const formats = store.listInvoiceFormats(admin);
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({ name: 'Standard', isDefault: true, definition: BUILTIN_DEFINITION });
    expect(store.listInvoiceFormats(admin)).toEqual(formats);
    expect(store.listInvoiceFormats(other)[0].id).not.toBe(formats[0].id);
  });

  it('lets any tenant member list formats but only an admin change them', () => {
    const { store, admin, member, definition } = setup();
    expect(store.listInvoiceFormats(member)).toHaveLength(1);
    const created = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    expect(() => store.createInvoiceFormat(member, { name: 'Sneaky', definition: definition() })).toThrow(/admin/);
    expect(() => store.updateInvoiceFormat(member, created.id, { name: 'Lean 2', definition: definition() })).toThrow(/admin/);
    expect(() => store.setDefaultInvoiceFormat(member, created.id)).toThrow(/admin/);
    expect(() => store.deleteInvoiceFormat(member, created.id)).toThrow(/admin/);
    expect(store.listInvoiceFormats(admin)).toHaveLength(2);
  });

  it('validates at the boundary and keeps names unique per tenant regardless of case', () => {
    const { store, admin, other, definition } = setup();
    expect(() => store.createInvoiceFormat(admin, { name: 'Bad', definition: definition({ accent: 'teal' }) })).toThrow(/colour/);
    expect(() => store.createInvoiceFormat(admin, { name: '', definition: definition() })).toThrow(/name/);
    store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    expect(() => store.createInvoiceFormat(admin, { name: 'lean', definition: definition() })).toThrow(/already/);
    expect(() => store.createInvoiceFormat(admin, { name: 'STANDARD', definition: definition() })).toThrow(/already/);
    expect(store.createInvoiceFormat(other, { name: 'Lean', definition: definition() }).name).toBe('Lean');
    expect(store.listInvoiceFormats(admin)).toHaveLength(2);
  });

  it('keeps exactly one default and moves it in a single step', () => {
    const { store, admin, definition } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition(), isDefault: true });
    expect(lean.isDefault).toBe(true);
    expect(store.listInvoiceFormats(admin).filter((format) => format.isDefault).map((format) => format.name)).toEqual(['Lean']);
    const standard = store.listInvoiceFormats(admin).find((format) => format.name === 'Standard')!;
    expect(store.setDefaultInvoiceFormat(admin, standard.id).isDefault).toBe(true);
    expect(store.listInvoiceFormats(admin).filter((format) => format.isDefault).map((format) => format.name)).toEqual(['Standard']);
  });

  it('refuses to delete the default, deletes any other, and never touches another tenant', () => {
    const { store, admin, other, definition } = setup();
    const standard = store.listInvoiceFormats(admin)[0];
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    expect(() => store.deleteInvoiceFormat(admin, standard.id)).toThrow(/default/);
    expect(() => store.deleteInvoiceFormat(other, lean.id)).toThrow(/not found/);
    expect(() => store.updateInvoiceFormat(other, lean.id, { name: 'Hijacked', definition: definition() })).toThrow(/not found/);
    expect(() => store.setDefaultInvoiceFormat(other, lean.id)).toThrow(/not found/);
    store.deleteInvoiceFormat(admin, lean.id);
    expect(store.listInvoiceFormats(admin).map((format) => format.name)).toEqual(['Standard']);
  });

  it('updates a format in place and keeps it the default', () => {
    const { store, admin, definition } = setup();
    const standard = store.listInvoiceFormats(admin)[0];
    const updated = store.updateInvoiceFormat(admin, standard.id, { name: 'House style', definition: definition({ accent: '#1f3a5f' }) });
    expect(updated).toMatchObject({ id: standard.id, name: 'House style', isDefault: true });
    expect(updated.definition.accent).toBe('#1f3a5f');
  });
});

describe('issuing with a format', () => {
  it('snapshots the tenant default when no format is chosen', () => {
    const { store, admin, issue } = setup();
    const standard = store.listInvoiceFormats(admin)[0];
    expect(issue().snapshot.format).toEqual({ id: standard.id, name: 'Standard', definition: BUILTIN_DEFINITION });
  });

  it('snapshots the chosen format and refuses one that belongs to another tenant', () => {
    const { store, admin, other, definition, issue } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const foreign = store.createInvoiceFormat(other, { name: 'Evo secret', definition: definition() });
    expect(issue(lean.id).snapshot.format).toMatchObject({ id: lean.id, name: 'Lean', definition: { layout: 'compact' } });
    expect(() => issue(foreign.id)).toThrow('The selected invoice format was not found.');
  });

  it('prints an issued invoice the same after the format is edited, made default elsewhere, or deleted', () => {
    const { store, admin, definition, issue } = setup();
    const noHsn = store.createInvoiceFormat(admin, { name: 'No HSN', definition: definition({ accent: '#1f3a5f', blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } }) });
    const invoice = issue(noHsn.id);
    const before = renderInvoiceHtml(store.getInvoice(admin, invoice.id)!);
    expect(before).not.toContain('HSN/SAC');
    expect(before).toContain('#1f3a5f');

    store.updateInvoiceFormat(admin, noHsn.id, { name: 'No HSN', definition: definition({ accent: '#7a1f1f' }) });
    store.setDefaultInvoiceFormat(admin, noHsn.id);
    expect(renderInvoiceHtml(store.getInvoice(admin, invoice.id)!)).toBe(before);

    const standard = store.listInvoiceFormats(admin).find((format) => format.name === 'Standard')!;
    store.setDefaultInvoiceFormat(admin, standard.id);
    store.deleteInvoiceFormat(admin, noHsn.id);
    expect(renderInvoiceHtml(store.getInvoice(admin, invoice.id)!)).toBe(before);
    expect(renderInvoiceHtml(issue())).toContain('HSN/SAC');
  });

  it('keeps the line HSN codes so the GST report is unaffected by a format that hides the column', () => {
    const { store, admin, definition, issue } = setup();
    const noHsn = store.createInvoiceFormat(admin, { name: 'No HSN', definition: definition({ blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } }) });
    issue(noHsn.id);
    expect(store.getGstSalesReport(admin, '2026-11').hsnSummary.map((row) => row.hsn)).toEqual(['998311']);
  });

  it('keeps the original format when an invoice is corrected, even after the default has changed', () => {
    const { store, admin, definition, issue } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const original = issue(lean.id);
    store.setDefaultInvoiceFormat(admin, store.listInvoiceFormats(admin).find((format) => format.name === 'Standard')!.id);
    const replacement = store.correctInvoice(admin, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 2, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] }, 'Quantity was wrong');
    expect(replacement.snapshot.format).toMatchObject({ id: lean.id, definition: { layout: 'compact' } });
  });

  it('falls back to the current default when the format of a corrected invoice has been deleted', () => {
    const { store, admin, definition, issue } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const original = issue(lean.id);
    store.deleteInvoiceFormat(admin, lean.id);
    const replacement = store.correctInvoice(admin, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 2, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] }, 'Quantity was wrong');
    expect(replacement.snapshot.format?.name).toBe('Standard');
  });

  it('snapshots the tenant default on bulk-generated invoices', () => {
    const { store, admin, definition } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }), isDefault: true });
    store.generateBulkInvoices(admin, '2026-11');
    const generated = store.listInvoices(admin, { pageSize: 100 }).items.filter((invoice) => invoice.invoiceDate === '2026-11-01');
    expect(generated.length).toBeGreaterThan(0);
    for (const invoice of generated) expect(invoice.snapshot.format).toMatchObject({ id: lean.id, name: 'Lean' });
  });
});

function buyerWith(store: ReturnType<typeof createTenantStore>, session: Parameters<ReturnType<typeof createTenantStore>['listCustomers']>[0], invoiceFormatId: string) {
  return store.createCustomer(session, { companyName: `Buyer ${crypto.randomUUID()}`, contactName: 'Buyer', email: 'buyer@example.com', phone: '9000000000', gstin: '', billingAddress: 'Bengaluru', invoiceDelivery: 'manual', invoiceFormatId });
}

describe('default format per customer', () => {
  it('prefers the customer default over the tenant default, and a format chosen for the invoice over both', () => {
    const { store, admin, definition, issue } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const retainer = store.createInvoiceFormat(admin, { name: 'Retainer', definition: definition({ accent: '#1f3a5f' }) });
    const client = { ...store.listCustomers(admin).items[0] };
    expect(client.invoiceFormatId).toBeNull();
    store.updateCustomer(admin, client.id, { ...client, invoiceFormatId: lean.id });
    expect(issue().snapshot.format?.name).toBe('Lean');
    expect(issue(retainer.id).snapshot.format?.name).toBe('Retainer');
    store.updateCustomer(admin, client.id, { ...client, invoiceFormatId: null });
    expect(issue().snapshot.format?.name).toBe('Standard');
  });

  it('keeps the default when a customer is edited without mentioning it', () => {
    const { store, admin, definition } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    const client = store.listCustomers(admin).items[0];
    store.updateCustomer(admin, client.id, { ...client, invoiceFormatId: lean.id });
    const withoutFormat: Partial<typeof client> = { ...client };
    delete withoutFormat.invoiceFormatId;
    expect(store.updateCustomer(admin, client.id, { ...(withoutFormat as typeof client), phone: '9111111111' }).invoiceFormatId).toBe(lean.id);
  });

  it('refuses a default that is not one of the tenant formats', () => {
    const { store, admin, other, definition } = setup();
    const foreign = store.createInvoiceFormat(other, { name: 'Evo secret', definition: definition() });
    const client = store.listCustomers(admin).items[0];
    expect(() => store.updateCustomer(admin, client.id, { ...client, invoiceFormatId: foreign.id })).toThrow('The selected invoice format was not found.');
    expect(() => buyerWith(store, admin, foreign.id)).toThrow('The selected invoice format was not found.');
  });

  it('clears the default of every customer when its format is deleted', () => {
    const { store, admin, definition, issue } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    const created = buyerWith(store, admin, lean.id);
    expect(created.invoiceFormatId).toBe(lean.id);
    store.deleteInvoiceFormat(admin, lean.id);
    expect(store.listCustomers(admin, { search: created.companyName }).items[0].invoiceFormatId).toBeNull();
    expect(issue().snapshot.format?.name).toBe('Standard');
  });

  it('uses the customer default for bulk-generated invoices', () => {
    const { store, admin, definition } = setup();
    const lean = store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const client = store.listCustomers(admin).items[0];
    store.updateCustomer(admin, client.id, { ...client, invoiceFormatId: lean.id });
    store.generateBulkInvoices(admin, '2026-11');
    const generated = store.listInvoices(admin, { pageSize: 100 }).items.filter((invoice) => invoice.invoiceDate === '2026-11-01' && invoice.customerId === client.id);
    expect(generated.length).toBeGreaterThan(0);
    for (const invoice of generated) expect(invoice.snapshot.format?.name).toBe('Lean');
  });
});

describe('migration', () => {
  it('adds the formats table to a database that predates it and leaves existing invoices without a format', () => {
    const folder = mkdtempSync(join(tmpdir(), 'formats-'));
    folders.push(folder);
    const filename = join(folder, 'old.sqlite');
    const first = createTenantStore(filename);
    const admin = first.authenticate('nexio-admin')!;
    const legacy = first.createIssuedInvoice(admin, { customerId: first.listCustomers(admin).items[0].id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 0 });
    first.close();
    const raw = new DatabaseSync(filename);
    raw.exec("DROP TABLE invoice_formats; ALTER TABLE customers DROP COLUMN invoice_format_id; UPDATE invoices SET snapshot = json_remove(snapshot, '$.format')");
    raw.close();

    const reopened = createTenantStore(filename);
    stores.push(reopened);
    expect(reopened.listInvoiceFormats(admin)[0].name).toBe('Standard');
    expect(reopened.getInvoice(admin, legacy.id)!.snapshot.format).toBeUndefined();
    expect(reopened.listCustomers(admin).items[0].invoiceFormatId).toBeNull();
  });
});
