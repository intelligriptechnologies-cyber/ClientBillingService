import { expect, test } from '@playwright/test';

test('correcting an older invoice preserves its stored venue', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const customerResponse = await page.request.get('/api/customers?pageSize=100');
  const customer = (await customerResponse.json() as { items: Array<{ id: string; gstin: string; companyName: string }> }).items[0];
  const token = `Legacy venue ${Date.now()}`;
  const createdResponse = await page.request.post('/api/invoices', { data: {
    customerId: customer.id, invoiceDate: '2026-10-07', dueDate: '2026-11-07', venue: token,
    gstApplicable: false, customerGstin: customer.gstin, lines: [{ description: token, quantity: 1, rateMinor: 10000, taxType: 'none', gstRate: 0 }],
  } });
  expect(createdResponse.ok()).toBeTruthy();
  const original = (await createdResponse.json() as { invoice: { id: string; invoiceNumber: string } }).invoice;
  await page.goto('/invoices');
  await page.getByLabel('Search invoices').fill(original.invoiceNumber);
  await page.getByRole('row', { name: new RegExp(original.invoiceNumber) }).getByRole('button', { name: 'Correct' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct invoice' });
  await expect(dialog.getByLabel('Venue')).toHaveCount(0);
  await dialog.getByLabel('Correction reason').fill('Correct amount');
  await dialog.getByRole('button', { name: 'Issue corrected invoice' }).click();
  await expect(dialog).toBeHidden();
  const response = await page.request.get(`/api/invoices?search=${encodeURIComponent(customer.companyName)}&pageSize=100`);
  const invoices = (await response.json() as { items: Array<{ id: string; status: string; snapshot: { venue?: string } }> }).items;
  const replacement = invoices.find((invoice) => invoice.id !== original.id && invoice.status === 'issued' && invoice.snapshot.venue === token);
  expect(replacement?.snapshot.venue).toBe(token);
});

test('invoice issue, correction, and payment detail edit use dialogs and preserve the ledger', async ({ page }) => {
  const token = `invoice-flow-${Date.now()}`;
  const companyName = `E2E ${token}`;
  await page.goto('/');
  await page.getByLabel('Demo identity').selectOption('nexio-admin');
  await page.getByRole('button', { name: 'Enter demo' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const customerResponse = await page.request.post('/api/customers', { data: {
    companyName, contactName: 'E2E Billing', email: `${token}@example.test`, phone: '9999999999',
    gstin: '', billingAddress: 'E2E isolated billing address', invoiceDelivery: 'manual',
  } });
  expect(customerResponse.ok()).toBeTruthy();
  const customer = await customerResponse.json() as { id: string };

  await page.goto('/invoices');
  await page.getByRole('button', { name: 'Add invoice' }).click();
  const add = page.getByRole('dialog', { name: 'Create invoice' });
  await expect(add).toBeVisible();
  await add.getByRole('combobox', { name: /^Customer \*/ }).selectOption(customer.id);
  await expect(add.getByLabel('Contract (optional)')).toHaveValue('');
  await add.getByLabel('Invoice date').fill('2026-10-07');
  await add.getByLabel('Due date').fill('2026-11-07');
  await expect(add.getByLabel('Venue')).toHaveCount(0);
  await add.getByLabel('GST Applicable').uncheck();
  await add.getByLabel('Description 1').fill('Monthly booking');
  await add.getByLabel('Rate 1').fill('1000');
  await add.getByRole('button', { name: 'Create Invoice' }).click();
  await expect(add).toBeHidden();

  await page.getByLabel('Search invoices').fill(companyName);
  const originalRow = page.getByRole('row', { name: new RegExp(companyName) }).first();
  await expect(originalRow).toBeVisible();
  await originalRow.getByRole('button', { name: 'Correct' }).click();
  const correct = page.getByRole('dialog', { name: 'Correct invoice' });
  await expect(correct).toBeVisible();
  await expect(correct.getByLabel('Venue')).toHaveCount(0);
  await correct.getByLabel('Due date').fill('2026-11-10');
  await correct.getByLabel('Rate 1').fill('1200');
  await correct.getByLabel('Correction reason').fill(`E2E correction ${token}`);
  await correct.getByRole('button', { name: 'Issue corrected invoice' }).click();
  await expect(correct).toBeHidden();

  const invoiceResponse = await page.request.get(`/api/invoices?search=${encodeURIComponent(companyName)}&pageSize=100`);
  expect(invoiceResponse.ok()).toBeTruthy();
  const invoices = (await invoiceResponse.json() as { items: Array<{ id: string; invoiceNumber: string; status: string; taxableMinor: number }> }).items;
  expect(invoices).toHaveLength(2);
  expect(invoices.find((item) => item.status === 'void')).toBeDefined();
  const replacement = invoices.find((item) => item.status === 'issued');
  expect(replacement?.taxableMinor).toBe(120000);
  await expect(page.getByRole('row', { name: new RegExp(replacement!.invoiceNumber) })).toBeVisible();

  await page.goto('/payments');
  await page.getByRole('button', { name: 'Record payment', exact: true }).first().click();
  const paymentForm = page.getByRole('form', { name: 'Record manual payment' });
  await paymentForm.getByLabel('Outstanding invoice').selectOption(replacement!.id);
  await paymentForm.getByLabel('Payment amount').fill('125');
  await paymentForm.getByRole('button', { name: 'Record allocation' }).click();
  await expect(paymentForm).toBeHidden();
  await page.getByLabel('Search payments').fill(companyName);
  const paymentRow = page.getByRole('table').last().getByRole('row', { name: new RegExp(replacement!.invoiceNumber) });
  await expect(paymentRow).toBeVisible();
  await paymentRow.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit payment details' });
  await editor.getByLabel('Method').selectOption('card');
  await editor.getByLabel('Reference').fill(`REF-${token}`);
  await editor.getByLabel('Notes').fill(`Corrected metadata ${token}`);
  await editor.getByRole('button', { name: 'Save details' }).click();
  await expect(editor).toBeHidden();
  await expect(paymentRow).toContainText('card');
  await expect(paymentRow).toContainText(`REF-${token}`);

  const paymentsResponse = await page.request.get(`/api/payments?search=${encodeURIComponent(companyName)}`);
  expect(paymentsResponse.ok()).toBeTruthy();
  const payment = (await paymentsResponse.json() as { items: Array<{ invoiceId: string; method: string; reference: string; notes: string; amountMinor: number }> }).items.find((item) => item.invoiceId === replacement!.id);
  expect(payment).toMatchObject({ method: 'card', reference: `REF-${token}`, notes: `Corrected metadata ${token}`, amountMinor: 12500 });
});
