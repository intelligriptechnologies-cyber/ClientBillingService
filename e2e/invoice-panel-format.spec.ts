import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { demoOrigin } from './test-ports';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SELLER_GSTIN = '29AAGCB7383J1Z4';
const NAVY = '#092a50';
const TEAL = '#079c9d';
const UPI_ID = 'test@upi.example';
const BANK = 'Account Name: Test Holder\nBank Name: Test Bank\nAccount Number: 000000000000\nIFSC Code: TEST0000000';
const FORMAT_NAME = 'Panel e2e';

type Settings = Record<string, unknown>;
type Format = { id: string; name: string; definition: Record<string, unknown> };
type Issued = { id: string; invoiceNumber: string };

async function pdfOf(request: APIRequestContext, invoice: Issued) {
  const download = await request.get(`/api/invoices/${invoice.id}/download`);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('application/pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(await download.body()), verbosity: 0 }).promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  return { squashed: text.replace(/\s+/g, '').toLowerCase(), pages: document.numPages };
}

async function issue(request: APIRequestContext, customerId: string, formatId: string, line: Record<string, unknown>): Promise<Issued> {
  const response = await request.post('/api/invoices', { data: { customerId, formatId, notes: 'Payable by NEFT within 7days of receipt.', invoiceDate: '2026-01-05', dueDate: '2026-01-19', lines: [line] } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json() as { invoice: Issued }).invoice;
}

async function openFormats(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Tenant settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Formats' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice formats' })).toBeVisible();
}

test.describe.serial('the Panel invoice layout', () => {
  let original: Settings;
  let customerId = '';
  let format: Format;

  test.beforeEach(async ({ page }) => {
    expect((await page.request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } })).ok()).toBeTruthy();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: demoOrigin, extraHTTPHeaders: { Origin: demoOrigin } });
    await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    const formats = (await (await request.get('/api/invoice-formats')).json() as { formats: Format[] }).formats;
    for (const stale of formats.filter((item) => item.name === FORMAT_NAME)) await request.delete(`/api/invoice-formats/${stale.id}`);
    if (original) await request.put('/api/settings', { data: original });
    await request.dispose();
  });

  test('an admin builds a Panel format and the live preview shows the panel sections and the UPI ID', async ({ page }) => {
    original = (await (await page.request.get('/api/settings')).json() as { settings: Settings }).settings;
    expect((await page.request.put('/api/settings', { data: { ...original, gstin: SELLER_GSTIN, legalName: 'Nexio Private Limited', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG } })).ok()).toBeTruthy();
    const customers = await (await page.request.get('/api/customers?pageSize=100')).json() as { items: Array<{ id: string; status: string; gstin: string }> };
    customerId = customers.items.find((item) => item.status === 'active' && item.gstin.startsWith('29'))!.id;

    await openFormats(page);
    await page.getByRole('button', { name: 'New format' }).click();
    await expect(page.getByLabel('Second accent colour', { exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: /Panel/ }).check();
    const preview = page.frameLocator('iframe[title="Invoice format preview"]');
    await expect(preview.getByText('BILL TO')).toBeVisible();
    await expect(preview.getByText('ISSUED BY')).toBeVisible();
    await expect(preview.getByText('TOTAL PAYABLE')).toBeVisible();

    await page.getByLabel('Format name').fill(FORMAT_NAME);
    await page.getByLabel('Accent colour', { exact: true }).fill(NAVY);
    await page.getByLabel('Second accent colour', { exact: true }).fill(TEAL);
    await expect(page.locator('.formats-form .form-error')).toHaveCount(0);
    await expect.poll(() => preview.locator('.pn-lines th.pn-a').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(9, 42, 80)');
    await expect.poll(() => preview.locator('.pn-lines th.pn-b').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(7, 156, 157)');

    await page.getByLabel('Bank details to print').fill(BANK);
    await page.getByLabel('UPI ID to print').fill(UPI_ID);
    await expect(preview.getByText(UPI_ID)).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'UPI ID text' }).check();
    await expect(preview.getByText(`UPI ID: ${UPI_ID}`)).toBeVisible();
    await expect(preview.getByText('Account Number: 000000000000')).toBeVisible();
    await expect(preview.locator('.upi-slot')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save format' }).click();
    await expect(page.getByRole('status')).toContainText(`"${FORMAT_NAME}" saved.`);
    await expect(page.getByRole('row', { name: new RegExp(FORMAT_NAME) })).toContainText('Panel');
    format = (await (await page.request.get('/api/invoice-formats')).json() as { formats: Format[] }).formats.find((item) => item.name === FORMAT_NAME)!;
    expect(format.definition).toMatchObject({ layout: 'panel', accent: NAVY, accentSecondary: TEAL, upiId: UPI_ID });
  });

  test('a GST invoice issued with it prints the panel sections, HSN column, tax rows and amounts in the PDF', async ({ page }) => {
    const invoice = await issue(page.request, customerId, format.id, { description: 'Hall rental', quantity: 2, rateMinor: 150_050, taxType: 'cgst_sgst', gstRate: 18, hsnSac: '998311' });
    const pdf = await pdfOf(page.request, invoice);
    expect(pdf.pages).toBe(1);
    for (const expected of ['TaxInvoice', `InvoiceNo:${invoice.invoiceNumber}`, 'BILLTO', 'ISSUEDBY', 'NexioPrivateLimited', `GSTIN:${SELLER_GSTIN}`, 'DESCRIPTION', 'HSN/SAC', '998311', 'RATE', 'QTY', 'AMOUNT', 'Hallrental', 'BANKDETAILS', 'AccountNumber:000000000000', 'UPI', `UPIID:${UPI_ID}`, 'Subtotal', '₹3,001.00', 'CGST', 'SGST', '₹270.09', 'Roundoff', '-₹0.18', 'TOTALPAYABLE', '₹3,541.00', 'Amountinwords:IndianRupeesThreeThousandFiveHundredFortyOneOnly', 'Notes:', 'PayablebyNEFTwithin7daysofreceipt.', 'AuthorizedSignatory']) expect(pdf.squashed, expected).toContain(expected.toLowerCase());
    expect(pdf.squashed).not.toContain('gst(ifapplicable)');

    const preview = await page.request.get(`/api/invoices/${invoice.id}/html`);
    expect(await preview.text()).toContain('<th class="pn-b num">RATE</th>');
  });

  test('a Bill of Supply issued with it prints Subtotal, GST (if applicable) of zero and TOTAL PAYABLE with no tax columns', async ({ page }) => {
    expect((await page.request.put('/api/settings', { data: { ...original, gstin: '', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG } })).ok()).toBeTruthy();
    const invoice = await issue(page.request, customerId, format.id, { description: 'Stock Management App Subscription', quantity: 2, rateMinor: 250_000, taxType: 'none', gstRate: 0 });
    const pdf = await pdfOf(page.request, invoice);
    expect(pdf.pages).toBe(1);
    for (const expected of ['BillofSupply', 'BILLTO', 'ISSUEDBY', 'StockManagementAppSubscription', 'BANKDETAILS', `UPIID:${UPI_ID}`, 'Subtotal', 'GST(ifapplicable)', '₹0.00', 'TOTALPAYABLE', '₹5,000.00', 'Amountinwords:IndianRupeesFiveThousandOnly', 'AuthorizedSignatory']) expect(pdf.squashed, expected).toContain(expected.toLowerCase());
    expect(pdf.squashed).not.toMatch(/igst|cgst|sgst|hsn\/sac|taxableValue|roundoff/i);
  });
});
