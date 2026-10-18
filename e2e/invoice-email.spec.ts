import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { demoOrigin } from './test-ports';

type Settings = Record<string, unknown>;
type Captured = { to: string[]; cc: string[]; from: string; subject: string; text: string; attachments: Array<{ filename: string; contentType: string; contentBase64: string }> };
type Delivery = { id: string; status: string; to: string[]; cc: string[]; subject: string; error: string };
type Issued = { invoice: { id: string; invoiceNumber: string }; customerEmail: string };

const captureFile = process.env.CLIENT_BILLING_MAIL_CAPTURE_FILE!;
const PASSWORD = 'e2e-smtp-secret-7c1d';
const captured = (): Captured[] => existsSync(captureFile) ? JSON.parse(readFileSync(captureFile, 'utf8')) as Captured[] : [];

// Dated before the seeded October invoice and due after it, so these invoices sort below it in the register and after it in pending payments.
async function issueInvoice(request: APIRequestContext): Promise<Issued> {
  const customers = await (await request.get('/api/customers?pageSize=100')).json() as { items: Array<{ id: string; status: string; email: string }> };
  const customer = customers.items.find((item) => item.status === 'active');
  expect(customer).toBeDefined();
  const response = await request.post('/api/invoices', { data: { customerId: customer!.id, invoiceDate: '2026-09-02', dueDate: '2026-11-30', taxSplitOverrideReason: 'Export to a registered buyer', lines: [{ description: 'Hall rental', quantity: 2, rateMinor: 150_050, taxType: 'none', gstRate: 0, hsnSac: '998311' }] } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { invoice: (await response.json() as { invoice: Issued['invoice'] }).invoice, customerEmail: customer!.email };
}
const deliveriesOf = async (request: APIRequestContext, invoiceId: string) => (await (await request.get(`/api/invoices/${invoiceId}/deliveries`)).json() as { deliveries: Delivery[] }).deliveries;

test.describe.serial('an issued invoice is emailed with its PDF and every attempt is logged', () => {
  let original: Settings; let unsent: Issued; let sent: Issued;

  test.beforeEach(async ({ request }) => {
    expect((await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } })).ok()).toBeTruthy();
    original ??= (await (await request.get('/api/settings')).json() as { settings: Settings }).settings;
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: demoOrigin, extraHTTPHeaders: { Origin: demoOrigin } });
    await request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    if (original) await request.put('/api/settings', { data: { ...original, smtpPassword: '' } });
    await request.dispose();
  });

  test('without SMTP settings the send answers not-configured and the attempt is logged, not sent', async ({ request }) => {
    expect((await request.put('/api/settings', { data: { ...original, smtpHost: '', smtpFrom: '' } })).ok()).toBeTruthy();
    unsent = await issueInvoice(request);
    const before = captured().length;

    const response = await request.post(`/api/invoices/${unsent.invoice.id}/send`, { data: {} });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ status: 'not-configured', message: expect.stringContaining('not set up') });
    expect(await deliveriesOf(request, unsent.invoice.id)).toMatchObject([{ status: 'not-configured' }]);
    expect(captured()).toHaveLength(before);
  });

  test('the Send by email dialog mails the customer the PDF and the Deliveries list shows it as sent', async ({ request, page }) => {
    const saved = await request.put('/api/settings', { data: { ...original, smtpHost: 'smtp.nexio.test', smtpPort: 587, smtpFrom: 'billing@nexio.test', smtpUser: 'billing', smtpPassword: PASSWORD } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    expect(await saved.text()).not.toContain(PASSWORD);
    const echoed = await (await request.get('/api/settings')).text();
    expect(echoed).not.toContain(PASSWORD);
    expect(JSON.parse(echoed).settings).toMatchObject({ smtpUser: 'billing', smtpPasswordSet: true });

    sent = await issueInvoice(request);
    const { invoice, customerEmail } = sent;
    await page.request.post('/api/auth/demo-login', { data: { userId: 'nexio-admin' } });
    await page.goto(`/invoices/${invoice.id}`);
    await expect(page.getByText('This invoice has not been emailed yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Send by email' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send invoice by email' });
    await expect(dialog.getByLabel('To', { exact: true })).toHaveValue(customerEmail);
    await expect(dialog.getByRole('textbox', { name: /^Message/ })).toHaveValue(new RegExp(invoice.invoiceNumber));
    await dialog.getByLabel('Cc', { exact: true }).fill('accounts@nexio.test');
    await dialog.getByRole('textbox', { name: /^Message/ }).fill(`Hello, the invoice ${invoice.invoiceNumber} is attached. Thanks!`);
    await dialog.getByRole('button', { name: 'Send email' }).click();

    await expect(page.getByRole('status')).toContainText(`${invoice.invoiceNumber} was emailed to ${customerEmail}`);
    const row = page.getByRole('row').filter({ hasText: customerEmail });
    await expect(row).toContainText('sent');
    await expect(row).toContainText('Cc accounts@nexio.test');

    const message = captured().find((item) => item.subject.includes(invoice.invoiceNumber));
    expect(message, 'the message reached the capture transport').toBeDefined();
    expect(message).toMatchObject({ to: [customerEmail], cc: ['accounts@nexio.test'], from: 'billing@nexio.test' });
    expect(message!.text).toContain('Thanks!');
    expect(JSON.stringify(captured())).not.toContain(PASSWORD);
    expect(message!.attachments).toHaveLength(1);
    expect(message!.attachments[0]).toMatchObject({ filename: `${invoice.invoiceNumber}.pdf`, contentType: 'application/pdf' });
    expect(Buffer.from(message!.attachments[0].contentBase64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const deliveries = await deliveriesOf(request, invoice.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'sent', to: [customerEmail], cc: ['accounts@nexio.test'], error: '' });
  });

  test('an email payment reminder is sent when SMTP is set up and a WhatsApp reminder says it was only recorded', async ({ request }) => {
    const { invoice, customerEmail } = sent;
    const email = await request.post(`/api/pending-payments/${invoice.id}/reminders`, { data: { channel: 'email', note: 'Please pay by Friday.' } });
    expect(email.ok(), await email.text()).toBeTruthy();
    expect(await email.json()).toMatchObject({ channel: 'email', delivery: 'sent', message: expect.stringContaining('sent to') });
    const reminder = captured().find((item) => item.subject.includes('Payment reminder') && item.subject.includes(invoice.invoiceNumber));
    expect(reminder).toMatchObject({ to: [customerEmail] });
    expect(reminder!.text).toContain('Please pay by Friday.');
    const afterEmail = await deliveriesOf(request, invoice.id);
    expect(afterEmail).toHaveLength(2);
    expect(afterEmail[0]).toMatchObject({ status: 'sent', subject: reminder!.subject });

    const whatsapp = await request.post(`/api/pending-payments/${invoice.id}/reminders`, { data: { channel: 'whatsapp' } });
    expect(await whatsapp.json()).toMatchObject({ channel: 'whatsapp', delivery: 'recorded', message: expect.stringContaining('recorded, not sent') });
    expect(await deliveriesOf(request, invoice.id)).toHaveLength(2);
  });

  test('bad addresses and void invoices are refused before anything is sent', async ({ request }) => {
    const before = captured().length;
    const bad = await request.post(`/api/invoices/${unsent.invoice.id}/send`, { data: { to: 'not-an-address' } });
    expect(bad.status()).toBe(400);
    expect((await bad.json() as { message: string }).message).toMatch(/^To:/);
    const truncated = await request.post(`/api/invoices/${unsent.invoice.id}/send`, { headers: { 'content-type': 'application/json' }, data: '{"to":"ap@acme.test"' });
    expect(truncated.status()).toBe(400);
    expect((await request.patch(`/api/invoices/${unsent.invoice.id}`, { data: { status: 'void', reason: 'Issued in error' } })).ok()).toBeTruthy();
    expect((await request.post(`/api/invoices/${unsent.invoice.id}/send`, { data: {} })).status()).toBe(409);
    expect(await deliveriesOf(request, unsent.invoice.id)).toMatchObject([{ status: 'not-configured' }]);
    expect(captured()).toHaveLength(before);
  });

  test('another tenant can neither read the delivery log nor send the invoice', async ({ request }) => {
    const { invoice, customerEmail } = sent;
    const sentCount = captured().length;

    expect((await request.post('/api/auth/demo-login', { data: { userId: 'evo-admin' } })).ok()).toBeTruthy();
    const read = await request.get(`/api/invoices/${invoice.id}/deliveries`);
    expect(read.status()).toBe(404);
    const readText = await read.text();
    for (const secret of [invoice.invoiceNumber, customerEmail, 'billing@nexio.test']) expect(readText).not.toContain(secret);
    const send = await request.post(`/api/invoices/${invoice.id}/send`, { data: { to: 'attacker@evil.test' } });
    expect(send.status()).toBe(404);
    expect(captured()).toHaveLength(sentCount);
  });
});
