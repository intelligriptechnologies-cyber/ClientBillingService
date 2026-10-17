// node control-billing.mjs run journeys/customer-then-invoice.mjs --as nexio-admin [--args '{"company":"Orbit Labs 1"}']
// Creates a customer through the Customers page, then an invoice for it through the Invoices dialog,
// and reads both rows back from the sqlite file. Selectors come from e2e/customers.spec.ts and e2e/invoice-line-items.spec.ts.
export default async function journey({ page, api, db, shot, args }) {
  const company = args.company ?? `Orbit Labs ${Date.now()}`;
  const rate = String(args.rate ?? 250);

  await page.goto('/customers');
  await page.getByRole('heading', { name: 'Customers' }).waitFor();
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Company name').fill(company);
  await page.getByLabel('Contact name').fill('Riya Rao');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('riya@orbit.example');
  await page.getByLabel('Phone').fill('+91 98765 00000');
  await page.getByLabel('Billing address').fill('42 Orbit Road, Bengaluru');
  await shot('customer-form-filled');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByText(company, { exact: true }).waitFor();
  await shot('customer-created');

  const found = await api('GET', `/api/customers?search=${encodeURIComponent(company)}`);
  const customer = found.body.items.find((item) => item.companyName === company);
  if (!customer) throw new Error(`API does not list ${company} after the UI created it.`);

  await page.goto('/invoices');
  await page.getByRole('heading', { name: 'Invoice register' }).waitFor();
  await page.getByRole('button', { name: 'Add invoice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create invoice' });
  await dialog.getByRole('combobox', { name: /^Customer \*/ }).selectOption(customer.id);
  await dialog.getByLabel('Description 1').fill('Consulting retainer');
  await dialog.getByLabel('Rate 1').fill(rate);
  await dialog.getByLabel('GST Applicable').uncheck();
  await shot('invoice-form-filled');
  await dialog.getByRole('button', { name: 'Create Invoice' }).click();
  await dialog.waitFor({ state: 'hidden' });

  const invoices = await api('GET', `/api/invoices?search=${encodeURIComponent(company)}`);
  const invoice = invoices.body.items.find((item) => item.customerId === customer.id);
  if (!invoice) throw new Error('The invoice register API does not list the new invoice.');
  await page.goto(`/invoices/${invoice.id}`);
  await page.getByText(invoice.invoiceNumber).first().waitFor();
  const detail = await shot('invoice-detail');

  const customerRow = await db('SELECT id, tenant_id, company_name, status FROM customers WHERE id = ?', [customer.id]);
  const invoiceRow = await db('SELECT invoice_number, customer_id, tenant_id, taxable_minor, gst_minor, total_minor, status FROM invoices WHERE customer_id = ?', [customer.id]);
  return { company, customerRow: customerRow.rows, invoiceRow: invoiceRow.rows, detailScreenshot: detail };
}
