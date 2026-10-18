import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_DEFINITION } from '../invoice-format';
import { renderInvoiceHtml } from '../invoice-html';
import { createTenantStore, type AppSession } from '../tenant-store';
import { tenantContextOf } from '../auth/session-context';

const SELLER_GSTIN = '29AAGCB7383J1Z4';
const stores: Array<ReturnType<typeof createTenantStore>> = [];
const folders: string[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

async function setup() {
  const store = createTenantStore(':memory:');
  stores.push(store);
  const admin = (await store.authenticate('nexio-admin'))!;
  const member = (await store.authenticate('nexio-user'))!;
  const other = (await store.authenticate('evo-admin'))!;
  await store.updateTenantSettings(tenantContextOf(admin), { ...await store.getTenantSettings(tenantContextOf(admin)), gstin: SELLER_GSTIN, legalName: 'Nexio Private Limited' });
  const customerId = (await store.listCustomers(tenantContextOf(admin))).items[0].id;
  const definition = (patch: Record<string, unknown> = {}) => ({ ...BUILTIN_DEFINITION, ...patch });
  const issue = (formatId?: string, session = admin) => store.createIssuedInvoice(session, { customerId, formatId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 1, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] });
  return { store, admin, member, other, customerId, definition, issue };
}

describe('tenant invoice formats', () => {
  it('gives every tenant a Standard default that matches what invoices printed before formats', async () => {
    const { store, admin, other } = await setup();
    const formats = await store.listInvoiceFormats(admin);
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({ name: 'Standard', isDefault: true, definition: BUILTIN_DEFINITION });
    expect(await store.listInvoiceFormats(admin)).toEqual(formats);
    expect((await store.listInvoiceFormats(other))[0].id).not.toBe(formats[0].id);
  });

  it('lets any tenant member list formats but only an admin change them', async () => {
    const { store, admin, member, definition } = await setup();
    expect(await store.listInvoiceFormats(member)).toHaveLength(1);
    const created = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    await expect(store.createInvoiceFormat(member, { name: 'Sneaky', definition: definition() })).rejects.toThrow(/admin/);
    await expect(store.updateInvoiceFormat(member, created.id, { name: 'Lean 2', definition: definition() })).rejects.toThrow(/admin/);
    await expect(store.setDefaultInvoiceFormat(member, created.id)).rejects.toThrow(/admin/);
    await expect(store.deleteInvoiceFormat(member, created.id)).rejects.toThrow(/admin/);
    expect(await store.listInvoiceFormats(admin)).toHaveLength(2);
  });

  it('validates at the boundary and keeps names unique per tenant regardless of case', async () => {
    const { store, admin, other, definition } = await setup();
    await expect(store.createInvoiceFormat(admin, { name: 'Bad', definition: definition({ accent: 'teal' }) })).rejects.toThrow(/colour/);
    await expect(store.createInvoiceFormat(admin, { name: '', definition: definition() })).rejects.toThrow(/name/);
    await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    await expect(store.createInvoiceFormat(admin, { name: 'lean', definition: definition() })).rejects.toThrow(/already/);
    await expect(store.createInvoiceFormat(admin, { name: 'STANDARD', definition: definition() })).rejects.toThrow(/already/);
    expect((await store.createInvoiceFormat(other, { name: 'Lean', definition: definition() })).name).toBe('Lean');
    expect(await store.listInvoiceFormats(admin)).toHaveLength(2);
  });

  it('keeps exactly one default and moves it in a single step', async () => {
    const { store, admin, definition } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition(), isDefault: true });
    expect(lean.isDefault).toBe(true);
    expect((await store.listInvoiceFormats(admin)).filter((format) => format.isDefault).map((format) => format.name)).toEqual(['Lean']);
    const standard = (await store.listInvoiceFormats(admin)).find((format) => format.name === 'Standard')!;
    expect((await store.setDefaultInvoiceFormat(admin, standard.id)).isDefault).toBe(true);
    expect((await store.listInvoiceFormats(admin)).filter((format) => format.isDefault).map((format) => format.name)).toEqual(['Standard']);
  });

  it('refuses to delete the default, deletes any other, and never touches another tenant', async () => {
    const { store, admin, other, definition } = await setup();
    const standard = (await store.listInvoiceFormats(admin))[0];
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    await expect(store.deleteInvoiceFormat(admin, standard.id)).rejects.toThrow(/default/);
    await expect(store.deleteInvoiceFormat(other, lean.id)).rejects.toThrow(/not found/);
    await expect(store.updateInvoiceFormat(other, lean.id, { name: 'Hijacked', definition: definition() })).rejects.toThrow(/not found/);
    await expect(store.setDefaultInvoiceFormat(other, lean.id)).rejects.toThrow(/not found/);
    await store.deleteInvoiceFormat(admin, lean.id);
    expect((await store.listInvoiceFormats(admin)).map((format) => format.name)).toEqual(['Standard']);
  });

  it('updates a format in place and keeps it the default', async () => {
    const { store, admin, definition } = await setup();
    const standard = (await store.listInvoiceFormats(admin))[0];
    const updated = await store.updateInvoiceFormat(admin, standard.id, { name: 'House style', definition: definition({ accent: '#1f3a5f' }) });
    expect(updated).toMatchObject({ id: standard.id, name: 'House style', isDefault: true });
    expect(updated.definition.accent).toBe('#1f3a5f');
  });
});

describe('issuing with a format', () => {
  it('snapshots the tenant default when no format is chosen', async () => {
    const { store, admin, issue } = await setup();
    const standard = (await store.listInvoiceFormats(admin))[0];
    expect((await issue()).snapshot.format).toEqual({ id: standard.id, name: 'Standard', definition: BUILTIN_DEFINITION });
  });

  it('snapshots the chosen format and refuses one that belongs to another tenant', async () => {
    const { store, admin, other, definition, issue } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const foreign = await store.createInvoiceFormat(other, { name: 'Evo secret', definition: definition() });
    expect((await issue(lean.id)).snapshot.format).toMatchObject({ id: lean.id, name: 'Lean', definition: { layout: 'compact' } });
    await expect(issue(foreign.id)).rejects.toThrow('The selected invoice format was not found.');
  });

  it('prints an issued invoice the same after the format is edited, made default elsewhere, or deleted', async () => {
    const { store, admin, definition, issue } = await setup();
    const noHsn = await store.createInvoiceFormat(admin, { name: 'No HSN', definition: definition({ accent: '#1f3a5f', blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } }) });
    const invoice = await issue(noHsn.id);
    const before = renderInvoiceHtml((await store.getInvoice(admin, invoice.id))!);
    expect(before).not.toContain('HSN/SAC');
    expect(before).toContain('#1f3a5f');

    await store.updateInvoiceFormat(admin, noHsn.id, { name: 'No HSN', definition: definition({ accent: '#7a1f1f' }) });
    await store.setDefaultInvoiceFormat(admin, noHsn.id);
    expect(renderInvoiceHtml((await store.getInvoice(admin, invoice.id))!)).toBe(before);

    const standard = (await store.listInvoiceFormats(admin)).find((format) => format.name === 'Standard')!;
    await store.setDefaultInvoiceFormat(admin, standard.id);
    await store.deleteInvoiceFormat(admin, noHsn.id);
    expect(renderInvoiceHtml((await store.getInvoice(admin, invoice.id))!)).toBe(before);
    expect(renderInvoiceHtml(await issue())).toContain('HSN/SAC');
  });

  it('keeps the line HSN codes so the GST report is unaffected by a format that hides the column', async () => {
    const { store, admin, definition, issue } = await setup();
    const noHsn = await store.createInvoiceFormat(admin, { name: 'No HSN', definition: definition({ blocks: { ...BUILTIN_DEFINITION.blocks, hsnSac: false } }) });
    await issue(noHsn.id);
    expect((await store.getGstSalesReport(admin, '2026-11')).hsnSummary.map((row) => row.hsn)).toEqual(['998311']);
  });

  it('keeps the original format when an invoice is corrected, even after the default has changed', async () => {
    const { store, admin, definition, issue } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const original = await issue(lean.id);
    await store.setDefaultInvoiceFormat(admin, (await store.listInvoiceFormats(admin)).find((format) => format.name === 'Standard')!.id);
    const replacement = await store.correctInvoice(admin, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 2, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] }, 'Quantity was wrong');
    expect(replacement.snapshot.format).toMatchObject({ id: lean.id, definition: { layout: 'compact' } });
  });

  it('falls back to the current default when the format of a corrected invoice has been deleted', async () => {
    const { store, admin, definition, issue } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const original = await issue(lean.id);
    await store.deleteInvoiceFormat(admin, lean.id);
    const replacement = await store.correctInvoice(admin, original.id, { invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Consulting', quantity: 2, rateMinor: 100_000, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] }, 'Quantity was wrong');
    expect(replacement.snapshot.format?.name).toBe('Standard');
  });

  it('snapshots the tenant default on bulk-generated invoices', async () => {
    const { store, admin, definition } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }), isDefault: true });
    await store.generateBulkInvoices(admin, '2026-11');
    const generated = (await store.listInvoices(admin, { pageSize: 100 })).items.filter((invoice) => invoice.invoiceDate === '2026-11-01');
    expect(generated.length).toBeGreaterThan(0);
    for (const invoice of generated) expect(invoice.snapshot.format).toMatchObject({ id: lean.id, name: 'Lean' });
  });
});

async function buyerWith(store: ReturnType<typeof createTenantStore>, session: AppSession, invoiceFormatId: string) {
  return store.createCustomer(tenantContextOf(session), { companyName: `Buyer ${crypto.randomUUID()}`, contactName: 'Buyer', email: 'buyer@example.com', phone: '9000000000', gstin: '', billingAddress: 'Bengaluru', invoiceDelivery: 'manual', invoiceFormatId });
}

describe('default format per customer', () => {
  it('prefers the customer default over the tenant default, and a format chosen for the invoice over both', async () => {
    const { store, admin, definition, issue } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const retainer = await store.createInvoiceFormat(admin, { name: 'Retainer', definition: definition({ accent: '#1f3a5f' }) });
    const client = { ...(await store.listCustomers(tenantContextOf(admin))).items[0] };
    expect(client.invoiceFormatId).toBeNull();
    await store.updateCustomer(tenantContextOf(admin), client.id, { ...client, invoiceFormatId: lean.id });
    expect((await issue()).snapshot.format?.name).toBe('Lean');
    expect((await issue(retainer.id)).snapshot.format?.name).toBe('Retainer');
    await store.updateCustomer(tenantContextOf(admin), client.id, { ...client, invoiceFormatId: null });
    expect((await issue()).snapshot.format?.name).toBe('Standard');
  });

  it('keeps the default when a customer is edited without mentioning it', async () => {
    const { store, admin, definition } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    const client = (await store.listCustomers(tenantContextOf(admin))).items[0];
    await store.updateCustomer(tenantContextOf(admin), client.id, { ...client, invoiceFormatId: lean.id });
    const withoutFormat: Partial<typeof client> = { ...client };
    delete withoutFormat.invoiceFormatId;
    expect((await store.updateCustomer(tenantContextOf(admin), client.id, { ...(withoutFormat as typeof client), phone: '9111111111' })).invoiceFormatId).toBe(lean.id);
  });

  it('refuses a default that is not one of the tenant formats', async () => {
    const { store, admin, other, definition } = await setup();
    const foreign = await store.createInvoiceFormat(other, { name: 'Evo secret', definition: definition() });
    const client = (await store.listCustomers(tenantContextOf(admin))).items[0];
    await expect(store.updateCustomer(tenantContextOf(admin), client.id, { ...client, invoiceFormatId: foreign.id })).rejects.toThrow('The selected invoice format was not found.');
    await expect(buyerWith(store, admin, foreign.id)).rejects.toThrow('The selected invoice format was not found.');
  });

  it('clears the default of every customer when its format is deleted', async () => {
    const { store, admin, definition, issue } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition() });
    const created = await buyerWith(store, admin, lean.id);
    expect(created.invoiceFormatId).toBe(lean.id);
    await store.deleteInvoiceFormat(admin, lean.id);
    expect((await store.listCustomers(tenantContextOf(admin), { search: created.companyName })).items[0].invoiceFormatId).toBeNull();
    expect((await issue()).snapshot.format?.name).toBe('Standard');
  });

  it('uses the customer default for bulk-generated invoices', async () => {
    const { store, admin, definition } = await setup();
    const lean = await store.createInvoiceFormat(admin, { name: 'Lean', definition: definition({ layout: 'compact' }) });
    const client = (await store.listCustomers(tenantContextOf(admin))).items[0];
    await store.updateCustomer(tenantContextOf(admin), client.id, { ...client, invoiceFormatId: lean.id });
    await store.generateBulkInvoices(admin, '2026-11');
    const generated = (await store.listInvoices(admin, { pageSize: 100 })).items.filter((invoice) => invoice.invoiceDate === '2026-11-01' && invoice.customerId === client.id);
    expect(generated.length).toBeGreaterThan(0);
    for (const invoice of generated) expect(invoice.snapshot.format?.name).toBe('Lean');
  });
});

describe('migration', () => {
  it('adds the formats table to a database that predates it and leaves existing invoices without a format', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'formats-'));
    folders.push(folder);
    const filename = join(folder, 'old.sqlite');
    const first = createTenantStore(filename);
    const admin = (await first.authenticate('nexio-admin'))!;
    const legacy = await first.createIssuedInvoice(admin, { customerId: (await first.listCustomers(tenantContextOf(admin))).items[0].id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 0 });
    await first.close();
    const raw = new DatabaseSync(filename);
    raw.exec("DROP TABLE invoice_formats; ALTER TABLE customers DROP COLUMN invoice_format_id; UPDATE invoices SET snapshot = json_remove(snapshot, '$.format')");
    raw.close();

    const reopened = createTenantStore(filename);
    stores.push(reopened);
    expect((await reopened.listInvoiceFormats(admin))[0].name).toBe('Standard');
    expect((await reopened.getInvoice(admin, legacy.id))!.snapshot.format).toBeUndefined();
    expect((await reopened.listCustomers(tenantContextOf(admin))).items[0].invoiceFormatId).toBeNull();
  });
});
