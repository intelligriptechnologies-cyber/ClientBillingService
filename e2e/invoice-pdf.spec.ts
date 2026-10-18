import { expect, test, type APIRequestContext } from '@playwright/test';
import { demoOrigin } from './test-ports';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SELLER_GSTIN = '29AAGCB7383J1Z4';

type Settings = Record<string, unknown>;

async function readPdf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  const operators = await page.getOperatorList();
  const imageOps = new Set<number>([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);
  return { text, squashed: text.replace(/\s+/g, ''), images: operators.fnArray.filter((op) => imageOps.has(op)).length, pages: document.numPages };
}

async function issueInvoice(request: APIRequestContext, taxType: 'cgst_sgst' | 'none') {
  const customers = await (await request.get('/api/customers?pageSize=100')).json() as { items: Array<{ id: string; status: string }> };
  const customer = customers.items.find((item) => item.status === 'active');
  expect(customer).toBeDefined();
  const response = await request.post('/api/invoices', { data: { customerId: customer!.id, invoiceDate: '2026-11-02', dueDate: '2026-11-16', lines: [{ description: 'Hall rental', quantity: 2, rateMinor: 150_050, taxType, gstRate: taxType === 'none' ? 0 : 18, hsnSac: '998311' }] } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json() as { invoice: { id: string; invoiceNumber: string } }).invoice;
}

test.describe.serial('invoice PDF prints what the preview shows', () => {
  let original: Settings;

  test.beforeEach(async ({ request }) => {
    expect((await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } })).ok()).toBeTruthy();
    original ??= (await (await request.get('/api/settings')).json() as { settings: Settings }).settings;
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: demoOrigin, extraHTTPHeaders: { Origin: demoOrigin } });
    await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    if (original) await request.put('/api/settings', { data: original });
    await request.dispose();
  });

  test('a Tax Invoice downloads as a real PDF with the rupee sign, branding, GST details and the amount in words', async ({ request, page }) => {
    const saved = await request.put('/api/settings', { data: { ...original, gstin: SELLER_GSTIN, legalName: 'Nexio Private Limited', logoDataUrl: PNG, stampDataUrl: PNG, signatureDataUrl: PNG } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const invoice = await issueInvoice(request, 'cgst_sgst');

    const download = await request.get(`/api/invoices/${invoice.id}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('application/pdf');
    expect(download.headers()['content-disposition']).toContain(`${invoice.invoiceNumber}.pdf`);
    const bytes = new Uint8Array(await download.body());
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

    const pdf = await readPdf(bytes);
    expect(pdf.pages).toBe(1);
    expect(pdf.squashed).toContain('₹');
    for (const expected of [invoice.invoiceNumber, 'TaxInvoice', 'NexioPrivateLimited', SELLER_GSTIN, 'HSN/SAC', '998311', 'CGST', 'SGST', '₹3,541.00', 'Roundoff', '-₹0.18', 'IndianRupeesThreeThousandFiveHundredFortyOneOnly']) expect(pdf.squashed, expected).toContain(expected.replace(/\s+/g, ''));
    expect(pdf.squashed, 'seller and buyer are both in Karnataka').not.toContain('IGST');
    expect(pdf.images).toBeGreaterThanOrEqual(3);

    await page.request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    await page.goto(`/invoices/${invoice.id}`);
    const preview = page.frameLocator('iframe[title="Invoice preview"]');
    await expect(preview.getByRole('heading', { name: 'Tax Invoice' })).toBeVisible();
    await expect(preview.locator('img')).toHaveCount(3);
    const shown = (await preview.locator('body').innerText()).replace(/\s+/g, '');
    for (const expected of [invoice.invoiceNumber, 'NexioPrivateLimited', SELLER_GSTIN, '998311', '₹3,541.00', '-₹0.18', 'IndianRupeesThreeThousandFiveHundredFortyOneOnly']) {
      expect(shown, expected).toContain(expected);
      expect(pdf.squashed, expected).toContain(expected);
    }
  });

  test('a Bill of Supply prints without GST columns', async ({ request }) => {
    expect((await request.put('/api/settings', { data: { ...original, gstin: '' } })).ok()).toBeTruthy();
    const invoice = await issueInvoice(request, 'none');
    const download = await request.get(`/api/invoices/${invoice.id}/download`);
    expect(download.headers()['content-type']).toBe('application/pdf');
    const pdf = await readPdf(new Uint8Array(await download.body()));
    expect(pdf.squashed).toContain('BillofSupply');
    expect(pdf.squashed).toContain('₹3,001.00');
    expect(pdf.squashed).not.toMatch(/IGST|CGST|SGST|TaxInvoice/);
  });

  test('the bulk preview downloads as a PDF with rupee amounts', async ({ request }) => {
    const download = await request.get('/api/invoices/bulk/download?period=2026-10');
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('application/pdf');
    const pdf = await readPdf(new Uint8Array(await download.body()));
    expect(pdf.squashed).toContain('Bulkinvoicepreview');
    expect(pdf.squashed).toContain('Aninvoicealreadyexistsforthiscontractandperiod.');
  });
});
