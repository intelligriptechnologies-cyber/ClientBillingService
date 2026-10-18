import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const SELLER_GSTIN = '29AAGCB7383J1Z4';
const NAVY = '#1f3a5f';
const MAROON = '#7a1f1f';

type Settings = Record<string, unknown>;
type Format = { id: string; name: string; isDefault: boolean; definition: Record<string, unknown> };
type Issued = { id: string; invoiceNumber: string };

async function readPdfText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  return { squashed: text.replace(/\s+/g, ''), pages: document.numPages };
}

async function pdfOf(request: APIRequestContext, invoice: Issued) {
  const download = await request.get(`/api/invoices/${invoice.id}/download`);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('application/pdf');
  return readPdfText(new Uint8Array(await download.body()));
}

async function htmlOf(request: APIRequestContext, invoice: Issued) {
  const response = await request.get(`/api/invoices/${invoice.id}/html`);
  expect(response.status()).toBe(200);
  return response.text();
}

async function formatsOf(request: APIRequestContext) {
  return (await (await request.get('/api/invoice-formats')).json() as { formats: Format[] }).formats;
}

async function issue(request: APIRequestContext, customerId: string, note: string, formatId?: string): Promise<Issued> {
  const response = await request.post('/api/invoices', { data: { customerId, formatId, notes: note, invoiceDate: '2026-01-05', dueDate: '2026-01-19', lines: [{ description: 'Hall rental', quantity: 2, rateMinor: 150_050, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' }] } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json() as { invoice: Issued }).invoice;
}

async function openFormats(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Tenant settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Formats' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice formats' })).toBeVisible();
}

test.describe.serial('named invoice formats', () => {
  let original: Settings;
  let customerId = '';
  let lean: Issued;
  let standardInvoice: Issued;

  test.beforeEach(async ({ page }) => {
    expect((await page.request.post('/api/auth/login', { data: { userId: 'nexio-admin' } })).ok()).toBeTruthy();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: `http://localhost:${Number(process.env.CLIENT_BILLING_TEST_PORT) || 3100}` });
    await request.post('/api/auth/login', { data: { userId: 'nexio-admin' } });
    const formats = await formatsOf(request);
    const standard = formats.find((format) => format.name === 'Standard');
    if (standard) await request.post(`/api/invoice-formats/${standard.id}/default`);
    for (const format of formats.filter((item) => item.name !== 'Standard')) await request.delete(`/api/invoice-formats/${format.id}`);
    if (original) await request.put('/api/settings', { data: original });
    await request.dispose();
  });

  test('an admin builds a format in Settings and the live preview follows every switch', async ({ page }) => {
    original = (await (await page.request.get('/api/settings')).json() as { settings: Settings }).settings;
    expect((await page.request.put('/api/settings', { data: { ...original, gstin: SELLER_GSTIN, legalName: 'Nexio Private Limited' } })).ok()).toBeTruthy();
    const customers = await (await page.request.get('/api/customers?pageSize=100')).json() as { items: Array<{ id: string; status: string; gstin: string }> };
    customerId = customers.items.find((item) => item.status === 'active' && item.gstin.startsWith('29'))!.id;
    expect(customerId).toBeTruthy();

    await openFormats(page);
    await expect(page.getByRole('row', { name: /Standard/ })).toContainText('Default');
    await page.getByRole('button', { name: 'New format' }).click();
    const preview = page.frameLocator('iframe[title="Invoice format preview"]');
    await expect(page.locator('iframe[title="Invoice format preview"]')).toHaveAttribute('sandbox', '');
    await expect(preview.getByRole('columnheader', { name: 'HSN/SAC' })).toBeVisible();
    await expect(preview.locator('main')).not.toHaveClass(/compact/);

    await page.getByLabel('Format name').fill('Lean no HSN');
    await page.getByRole('checkbox', { name: 'HSN/SAC column' }).uncheck();
    await expect(preview.getByRole('columnheader', { name: 'HSN/SAC' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Amount in words' }).uncheck();
    await expect(preview.getByText('Indian Rupees')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'UPI QR slot' }).check();
    await expect(preview.getByText('UPI QR', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: /Compact/ }).check();
    await expect(preview.locator('main')).toHaveClass(/compact/);

    await page.getByLabel('Accent colour', { exact: true }).fill('#f5f5a0');
    await expect(page.locator('.formats-form .form-error')).toContainText('darker');
    await expect(page.getByRole('button', { name: 'Save format' })).toBeDisabled();
    await page.getByLabel('Accent colour', { exact: true }).fill(NAVY);
    await expect(page.locator('.formats-form .form-error')).toHaveCount(0);
    await expect.poll(() => preview.locator('.masthead').evaluate((element) => getComputedStyle(element).borderBottomColor)).toBe('rgb(31, 58, 95)');
    await page.getByLabel('Bank details to print').fill('HDFC Bank\nA/C 5020000123');
    await expect(preview.getByText('A/C 5020000123')).toBeVisible();

    await page.getByRole('button', { name: 'Save format' }).click();
    await expect(page.getByRole('status')).toContainText('"Lean no HSN" saved.');
    const row = page.getByRole('row', { name: /Lean no HSN/ });
    await expect(row).toContainText('Compact');
    await expect(row).not.toContainText('Default');
    await row.getByRole('button', { name: /Make default/ }).click();
    await expect(page.getByRole('row', { name: /Lean no HSN/ })).toContainText('Default');
    await page.getByRole('row', { name: /Standard/ }).getByRole('button', { name: /Make default/ }).click();
    await expect(page.getByRole('row', { name: /Standard/ })).toContainText('Default');
    await expect(page.getByRole('row', { name: /Lean no HSN/ })).not.toContainText('Default');
  });

  test('the invoice editor preselects the default format and issues with the one chosen', async ({ page }) => {
    const formats = await formatsOf(page.request);
    const standard = formats.find((format) => format.name === 'Standard')!;
    const leanFormat = formats.find((format) => format.name === 'Lean no HSN')!;
    await page.goto('/invoices');
    await page.getByRole('button', { name: 'Add invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create invoice' });
    const select = dialog.getByLabel('Invoice format');
    await expect(select).toHaveValue(standard.id);
    await expect(select.locator('option:checked')).toHaveText('Standard (default)');
    await select.selectOption({ label: 'Lean no HSN' });
    await dialog.getByRole('combobox', { name: /^Customer \*/ }).selectOption(customerId);
    await expect(dialog.getByText('Tax Invoice', { exact: true })).toBeVisible();
    await dialog.getByLabel('Invoice Date').fill('2026-01-05');
    await dialog.getByLabel('Due Date').fill('2026-01-19');
    await dialog.getByLabel('Description 1').fill('Hall rental');
    await dialog.getByLabel('HSN/SAC 1').fill('998311');
    await dialog.getByLabel('Quantity 1').fill('2');
    await dialog.getByLabel('Rate 1').fill('1500.50');
    await dialog.getByLabel('Notes').fill('lean from the editor');
    await dialog.getByRole('button', { name: 'Create Invoice' }).click();
    await expect(dialog).toBeHidden();

    const list = await (await page.request.get('/api/invoices?pageSize=100')).json() as { items: Array<Issued & { snapshot: { notes?: string; format?: { id: string; name: string } } }> };
    const created = list.items.find((item) => item.snapshot.notes === 'lean from the editor')!;
    expect(created.snapshot.format).toMatchObject({ id: leanFormat.id, name: 'Lean no HSN' });
    lean = created;
    standardInvoice = await issue(page.request, customerId, 'standard by default');
  });

  test('the PDF drops the HSN column for the format that hides it and keeps it for the other', async ({ page }) => {
    const leanPdf = await pdfOf(page.request, lean);
    expect(leanPdf.pages).toBe(1);
    expect(leanPdf.squashed).toContain('TaxInvoice');
    expect(leanPdf.squashed).toContain('Hallrental');
    expect(leanPdf.squashed).not.toContain('HSN/SAC');
    expect(leanPdf.squashed).not.toContain('998311');
    expect(leanPdf.squashed).not.toContain('IndianRupees');
    expect(leanPdf.squashed).toContain('UPIQR');
    expect(leanPdf.squashed).toContain('A/C5020000123');

    const standardPdf = await pdfOf(page.request, standardInvoice);
    expect(standardPdf.squashed).toContain('HSN/SAC');
    expect(standardPdf.squashed).toContain('998311');
    expect(standardPdf.squashed).toContain('IndianRupees');

    const leanHtml = await htmlOf(page.request, lean);
    expect(leanHtml).toContain(`border-bottom: 2px solid ${NAVY}`);
    expect(leanHtml).toContain('class="sheet compact"');
    expect(await htmlOf(page.request, standardInvoice)).toContain('border-bottom: 2px solid #11756c');
  });

  test('editing or deleting the format afterwards never changes the issued invoice', async ({ page }) => {
    const leanFormat = (await formatsOf(page.request)).find((format) => format.name === 'Lean no HSN')!;
    const beforeHtml = await htmlOf(page.request, lean);

    const edited = await page.request.put(`/api/invoice-formats/${leanFormat.id}`, { data: { name: 'Lean no HSN', definition: { ...leanFormat.definition, layout: 'classic', accent: MAROON, blocks: { ...(leanFormat.definition.blocks as object), hsnSac: true, amountInWords: true } } } });
    expect(edited.ok(), await edited.text()).toBeTruthy();
    const afterEdit = await pdfOf(page.request, lean);
    expect(afterEdit.squashed).not.toContain('HSN/SAC');
    expect(afterEdit.squashed).not.toContain('IndianRupees');
    expect(await htmlOf(page.request, lean)).toBe(beforeHtml);
    expect(beforeHtml).not.toContain(MAROON);

    const fresh = await issue(page.request, customerId, 'after edit', leanFormat.id);
    const freshHtml = await htmlOf(page.request, fresh);
    expect(freshHtml).toContain(`border-bottom: 2px solid ${MAROON}`);
    expect((await pdfOf(page.request, fresh)).squashed).toContain('HSN/SAC');

    const removed = await page.request.delete(`/api/invoice-formats/${leanFormat.id}`);
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect(await htmlOf(page.request, lean)).toBe(beforeHtml);
    expect((await pdfOf(page.request, lean)).squashed).not.toContain('HSN/SAC');
    expect((await page.request.post('/api/invoices', { data: { customerId, formatId: leanFormat.id, invoiceDate: '2026-01-05', dueDate: '2026-01-19', taxableMinor: 100 } })).status()).toBe(400);
  });

  test('a customer default format is preselected in the editor and can be overridden for one invoice', async ({ page }) => {
    const blocks = { hsnSac: true, bankDetails: true, upiQr: false, signature: true, stamp: true, terms: true, amountInWords: true };
    const created = await page.request.post('/api/invoice-formats', { data: { name: 'Client navy', definition: { layout: 'compact', blocks, accent: NAVY, logo: 'show', bankDetails: '', terms: '' } } });
    const navy = (await created.json() as { format: Format }).format;
    const standard = (await formatsOf(page.request)).find((format) => format.name === 'Standard')!;
    const name = `Format client ${Date.now()}`;
    const customer = await page.request.post('/api/customers', { data: { companyName: name, contactName: 'Buyer', email: 'buyer@example.com', phone: '9000000000', gstin: SELLER_GSTIN, billingAddress: 'Bengaluru', invoiceDelivery: 'manual' } });
    const customerRecord = await customer.json() as { id: string; invoiceFormatId: string | null };
    expect(customerRecord.invoiceFormatId).toBeNull();

    await page.goto('/customers');
    await page.getByLabel('Search customers').fill(name);
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Default invoice format').selectOption({ label: 'Client navy' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const saved = await (await page.request.get(`/api/customers?search=${encodeURIComponent(name)}`)).json() as { items: Array<{ invoiceFormatId: string | null }> };
    expect(saved.items[0].invoiceFormatId).toBe(navy.id);

    await page.goto('/invoices');
    await page.getByRole('button', { name: 'Add invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create invoice' });
    const select = dialog.getByLabel('Invoice format');
    await expect(select).toHaveValue(standard.id);
    await dialog.getByRole('combobox', { name: /^Customer \*/ }).selectOption(customerRecord.id);
    await expect(select).toHaveValue(navy.id);
    await expect(select.locator('option:checked')).toHaveText('Client navy (customer default)');
    await select.selectOption({ label: 'Standard (default)' });
    await dialog.getByLabel('Invoice Date').fill('2026-01-05');
    await dialog.getByLabel('Due Date').fill('2026-01-19');
    await dialog.getByLabel('Description 1').fill('Hall rental');
    await dialog.getByLabel('HSN/SAC 1').fill('998311');
    await dialog.getByLabel('Rate 1').fill('1500');
    await dialog.getByLabel('Notes').fill('override standard');
    await dialog.getByRole('button', { name: 'Create Invoice' }).click();
    await expect(dialog).toBeHidden();

    const list = await (await page.request.get('/api/invoices?pageSize=100')).json() as { items: Array<{ snapshot: { notes?: string; format?: { name: string } } }> };
    expect(list.items.find((item) => item.snapshot.notes === 'override standard')?.snapshot.format?.name).toBe('Standard');
    const byDefault = await issue(page.request, customerRecord.id, 'client default applies');
    expect(await htmlOf(page.request, byDefault)).toContain(`border-bottom: 2px solid ${NAVY}`);
  });

  test('a user without admin rights can pick a format but cannot change them', async ({ page }) => {
    expect((await page.request.post('/api/auth/login', { data: { userId: 'nexio-user' } })).ok()).toBeTruthy();
    expect((await page.request.get('/api/invoice-formats')).ok()).toBeTruthy();
    const denied = await page.request.post('/api/invoice-formats', { data: { name: 'Sneaky', definition: { layout: 'classic', accent: NAVY, logo: 'show' } } });
    expect(denied.status()).toBe(400);
    expect((await denied.json() as { message: string }).message).toContain('admin');
  });
});
