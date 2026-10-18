import { clickMenuLink } from './navigation';
import { expect, test, type Page } from '@playwright/test';

const KARNATAKA_GSTIN = '29AAGCB7383J1Z4';
const MAHARASHTRA_GSTIN = '27AAPFU0939F1ZV';
const run = Date.now();

test.describe.configure({ mode: 'serial' });

async function enterOd(page: Page) {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('od-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createCustomer(page: Page, name: string, fields: { gstin?: string; stateCode?: string }) {
  const response = await page.request.post('/api/customers', { data: { companyName: name, contactName: 'GST Buyer', email: `${run}@example.test`, phone: '9999999999', gstin: fields.gstin ?? '', stateCode: fields.stateCode ?? '', billingAddress: 'GST buyer address', invoiceDelivery: 'manual' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json() as { id: string }).id;
}

async function openInvoiceDialog(page: Page, customerId: string) {
  await page.goto('/invoices');
  await page.getByRole('button', { name: 'Add invoice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create invoice' });
  await dialog.getByRole('combobox', { name: /^Customer \*/ }).selectOption(customerId);
  return dialog;
}

async function issuedInvoice(page: Page, customerName: string) {
  const response = await page.request.get(`/api/invoices?search=${encodeURIComponent(customerName)}`);
  const { items } = await response.json() as { items: Array<{ id: string; gstMinor: number; snapshot: { documentType?: string; sellerStateCode?: string; placeOfSupplyStateCode?: string; taxSplit?: string; taxSplitOverrideReason?: string; lines?: Array<{ taxType: string; hsnSac?: string }> } }> };
  expect(items).toHaveLength(1);
  return items[0];
}

test('an unregistered seller issues a Bill of Supply without GST columns', async ({ page }) => {
  await enterOd(page);
  const name = `Unregistered seller buyer ${run}`;
  const customerId = await createCustomer(page, name, { stateCode: '29' });
  const dialog = await openInvoiceDialog(page, customerId);
  await expect(dialog.getByText('Your company has no GSTIN yet')).toBeVisible();
  await expect(dialog).toContainText('Bill of Supply');
  await expect(dialog.getByText('Add your GSTIN in Settings to charge GST')).toBeVisible();
  await expect(dialog.getByLabel('GST Applicable')).toBeDisabled();
  await expect(dialog.getByLabel('GST Applicable')).not.toBeChecked();
  await expect(dialog.getByLabel('Tax type 1')).toBeDisabled();
  await expect(dialog.getByLabel('Tax type 1')).toHaveValue('none');
  await expect(dialog.getByLabel('GST percent 1')).toBeDisabled();
  await dialog.getByLabel('Description 1').fill('Court booking');
  await dialog.getByLabel('Rate 1').fill('500');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog).toBeHidden();

  const invoice = await issuedInvoice(page, name);
  expect(invoice).toMatchObject({ gstMinor: 0, snapshot: { gstApplicable: false } });
  const taxed = await page.request.post('/api/invoices', { data: { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', gstApplicable: true, lines: [{ description: 'Court booking', quantity: 1, rateMinor: 50_000, taxType: 'igst', gstRate: 18 }] } });
  expect(taxed.status()).toBe(400);
  expect((await taxed.json() as { message: string }).message).toContain('Add your GSTIN in Settings to charge GST, or set the lines to no tax');
  expect(invoice.snapshot).toMatchObject({ documentType: 'Bill of Supply', sellerStateCode: '', placeOfSupplyStateCode: '29' });
  await page.goto(`/invoices/${invoice.id}`);
  await expect(page.getByRole('heading', { name: /^Bill of Supply / })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tax', exact: true })).toHaveCount(0);
  await expect(page.getByText('GSTIN', { exact: true })).toHaveCount(0);
});

test('an invalid seller GSTIN is rejected and a valid one shows the state it implies', async ({ page }) => {
  await enterOd(page);
  await clickMenuLink(page, 'Admin Console', 'Company Settings');
  await page.waitForURL('**/settings');
  await page.getByRole('button', { name: 'Edit settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit company settings' });

  await dialog.getByLabel('GSTIN').fill('29AAGCB7383J1Z5');
  await expect(dialog).toContainText('check digit does not match');
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog.getByRole('alert')).toContainText('check digit');

  await dialog.getByLabel('GSTIN').fill(KARNATAKA_GSTIN.toLowerCase());
  await dialog.getByLabel('Legal name').fill('OD Badminton Private Limited');
  await expect(dialog).toContainText('State: Karnataka (29)');
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await expect(page.getByText(`${KARNATAKA_GSTIN} · Karnataka`)).toBeVisible();
});

test('an intra-state client gets CGST + SGST preselected and a Tax Invoice', async ({ page }) => {
  await enterOd(page);
  const name = `Intra-state buyer ${run}`;
  const dialog = await openInvoiceDialog(page, await createCustomer(page, name, { stateCode: '29' }));
  await expect(dialog.getByLabel('Tax type 1')).toHaveValue('cgst_sgst');
  await expect(dialog).toContainText('Tax Invoice');
  await dialog.getByLabel('Description 1').fill('Court booking');
  await dialog.getByLabel('Rate 1').fill('1000');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog.getByRole('alert')).toContainText('HSN/SAC');
  await dialog.getByLabel('HSN/SAC 1').fill('997212');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog).toBeHidden();

  const invoice = await issuedInvoice(page, name);
  expect(invoice).toMatchObject({ gstMinor: 18000, snapshot: { documentType: 'Tax Invoice', sellerStateCode: '29', placeOfSupplyStateCode: '29', taxSplit: 'intra', lines: [{ taxType: 'cgst_sgst', hsnSac: '997212' }] } });
  await page.goto(`/invoices/${invoice.id}`);
  await expect(page.getByRole('heading', { name: /^Tax Invoice / })).toBeVisible();
  await expect(page.getByRole('row', { name: /Court booking/ })).toContainText('CGST + SGST 18%');
});

test('a client registered in another state gets IGST preselected', async ({ page }) => {
  await enterOd(page);
  const name = `Inter-state buyer ${run}`;
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Add customer' }).click();
  const customerDialog = page.getByRole('dialog');
  await customerDialog.getByLabel('Company name', { exact: true }).fill(name);
  await customerDialog.getByLabel('Contact name', { exact: true }).fill('GST Buyer');
  await customerDialog.getByLabel('Email', { exact: true }).fill(`inter-${run}@example.test`);
  await customerDialog.getByLabel('Phone', { exact: true }).fill('9999999999');
  await customerDialog.getByLabel('Billing address', { exact: true }).fill('Mumbai');
  await customerDialog.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZX');
  await customerDialog.getByRole('button', { name: 'Create customer' }).click();
  await expect(customerDialog.getByRole('alert')).toContainText('check digit');
  await expect(customerDialog.getByLabel('Billing state', { exact: true })).toHaveCount(0);
  await customerDialog.getByLabel('GSTIN', { exact: true }).fill(MAHARASHTRA_GSTIN);
  await expect(customerDialog).toContainText('Maharashtra');
  await customerDialog.getByRole('button', { name: 'Create customer' }).click();
  await expect(customerDialog).toBeHidden();

  const customers = await (await page.request.get(`/api/customers?search=${encodeURIComponent(name)}`)).json() as { items: Array<{ id: string; stateCode: string }> };
  expect(customers.items[0].stateCode).toBe('27');
  const dialog = await openInvoiceDialog(page, customers.items[0].id);
  await expect(dialog.getByLabel('Tax type 1')).toHaveValue('igst');
  await dialog.getByLabel('Description 1').fill('Tournament entry');
  await dialog.getByLabel('HSN/SAC 1').fill('999699');
  await dialog.getByLabel('Rate 1').fill('2000');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog).toBeHidden();
  expect(await issuedInvoice(page, name)).toMatchObject({ gstMinor: 36000, snapshot: { documentType: 'Tax Invoice', placeOfSupplyStateCode: '27', taxSplit: 'inter', lines: [{ taxType: 'igst' }] } });
});

test('overriding the preselected tax split needs a reason that is kept on the invoice', async ({ page }) => {
  await enterOd(page);
  const name = `Override buyer ${run}`;
  const dialog = await openInvoiceDialog(page, await createCustomer(page, name, { stateCode: '29' }));
  await expect(dialog.getByLabel('Tax type 1')).toHaveValue('cgst_sgst');
  await dialog.getByLabel('Description 1').fill('Supply to an SEZ unit');
  await dialog.getByLabel('HSN/SAC 1').fill('997212');
  await dialog.getByLabel('Rate 1').fill('1000');
  await dialog.getByLabel('Tax type 1').selectOption('igst');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog.getByRole('alert')).toContainText('reason');
  await dialog.getByLabel('Tax split override reason').fill('Place of supply is an SEZ unit');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(dialog).toBeHidden();
  expect(await issuedInvoice(page, name)).toMatchObject({ snapshot: { taxSplit: 'intra', taxSplitOverrideReason: 'Place of supply is an SEZ unit', lines: [{ taxType: 'igst' }] } });
});

test('correcting an invoice issued without line items keeps the split it was issued with', async ({ page }) => {
  await enterOd(page);
  const name = `Correction buyer ${run}`;
  const customerId = await createCustomer(page, name, { stateCode: '29' });
  const issued = await page.request.post('/api/invoices', { data: { customerId, invoiceDate: '2026-11-02', dueDate: '2026-11-16', taxableMinor: 100_000, gstRate: 18 } });
  expect(issued.ok(), await issued.text()).toBeTruthy();
  const invoice = (await issued.json() as { invoice: { invoiceNumber: string } }).invoice;
  await page.goto('/invoices');
  await page.getByLabel('Search invoices').fill(name);
  await page.getByRole('row', { name: new RegExp(invoice.invoiceNumber) }).getByRole('button', { name: 'Correct' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct invoice' });
  await expect(dialog.getByLabel('Tax type 1')).toHaveValue('cgst_sgst');
  await expect(dialog.getByLabel('GST percent 1')).toHaveValue('18');
  await expect(dialog.getByLabel('Tax split override reason')).toHaveCount(0);
});

test('the GSTR-1 export classifies the new invoices and summarises their HSN/SAC codes', async ({ page }) => {
  await enterOd(page);
  const month = new Date().toISOString().slice(0, 7);
  const report = await (await page.request.get(`/api/reports/gst?month=${month}`)).json() as { items: Array<{ customerName: string; section: string }>; hsnSummary: Array<{ hsn: string }> };
  const sectionOf = (name: string) => report.items.find((item) => item.customerName === name)?.section;
  expect(sectionOf(`Unregistered seller buyer ${run}`)).toBe('NIL_EXEMPT_NON_GST');
  expect(sectionOf(`Intra-state buyer ${run}`)).toBe('B2CS');
  expect(sectionOf(`Inter-state buyer ${run}`)).toBe('B2B');
  expect(report.hsnSummary.map((row) => row.hsn)).toEqual(expect.arrayContaining(['997212', '999699']));
  const csv = await (await page.request.get(`/api/reports/gst?month=${month}&format=hsn-csv`)).text();
  expect(csv).toContain('"HSN/SAC","Description","Quantity","Taxable value","Tax"');
});
