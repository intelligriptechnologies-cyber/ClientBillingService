import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailer, type SmtpTransport } from '@/lib/mailer';
import { getInvoiceEmailDefaults, MailServiceError, sendInvoiceEmail, sendPaymentReminder, testSmtp, type MailDeps } from '@/lib/mail-service';
import { settingsInput } from '@/lib/test-helpers';
import { createTenantStore, type AppSession } from '@/lib/tenant-store';

type Store = ReturnType<typeof createTenantStore>;
const PASSWORD = 'hunter2-secret';
const INVOICE = 'nexio-invoice-001';
const pdfBytes = new TextEncoder().encode('%PDF-1.4 rendered');

let store: Store; let admin: AppSession; let user: AppSession; let evo: AppSession; let superadmin: AppSession;
let sent: Array<Parameters<SmtpTransport['sendMail']>[0]>; let transportBehaviour: Partial<SmtpTransport>; let renderPdf: ReturnType<typeof vi.fn>; let deps: MailDeps;

function must<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error('Expected fixture'); return value; }
function configure(session: AppSession, extra: Record<string, unknown> = {}) {
  return store.updateTenantSettings(session, { ...settingsInput(store.getTenantSettings(session)), smtpHost: 'smtp.nexio.example', smtpPort: 587, smtpFrom: 'billing@nexio.example', smtpUser: 'billing', smtpPassword: PASSWORD, ...extra });
}
async function rejection(promise: Promise<unknown>) { try { await promise; } catch (cause) { return cause; } throw new Error('Expected a rejection'); }

beforeEach(() => {
  store = createTenantStore(':memory:');
  admin = must(store.authenticate('nexio-admin')); user = must(store.authenticate('nexio-user')); evo = must(store.authenticate('evo-admin')); superadmin = must(store.authenticate('superadmin'));
  sent = []; transportBehaviour = {}; renderPdf = vi.fn(async () => pdfBytes);
  deps = { renderPdf, mailer: createMailer({ env: {}, createTransport: () => ({ sendMail: async (mail) => { sent.push(mail); return { messageId: '<m1@fake>' }; }, verify: async () => true, ...transportBehaviour }) }) };
});
afterEach(() => store.close());

describe('SMTP settings never expose the password', () => {
  it('stores it, reports only that it is set, and keeps it when a later save omits it', () => {
    expect(store.getTenantSettings(admin)).toMatchObject({ smtpUser: '', smtpPasswordSet: false });
    const saved = configure(admin);
    expect(saved).toMatchObject({ smtpUser: 'billing', smtpPasswordSet: true });
    expect(JSON.stringify(saved)).not.toContain(PASSWORD); expect(JSON.stringify(store.getTenantSettings(admin))).not.toContain(PASSWORD);
    store.updateTenantSettings(admin, { ...settingsInput(store.getTenantSettings(admin)), companyName: 'Nexio Renamed' });
    expect(store.getSmtpSettings(admin).password).toBe(PASSWORD);
    configure(admin, { smtpPassword: '' });
    expect(store.getTenantSettings(admin).smtpPasswordSet).toBe(false); expect(store.getSmtpSettings(admin).password).toBe('');
  });

  it('keeps another tenant out of the stored password and out of the logs', async () => {
    configure(admin);
    expect(store.getSmtpSettings(evo).password).toBe(''); expect(store.getTenantSettings(evo).smtpPasswordSet).toBe(false);
    await testSmtp(store, admin, deps); await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(JSON.stringify(store.listOperationalLogs(admin))).not.toContain(PASSWORD);
    expect(JSON.stringify(store.listDeliveries(admin, INVOICE))).not.toContain(PASSWORD);
  });
});

describe('sending an invoice', () => {
  it('attaches the rendered PDF, mails the customer billing address by default and logs a sent delivery', async () => {
    configure(admin);
    const result = await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(result).toMatchObject({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: 'billing@nexio.example', to: ['billing@nexio.example'] });
    expect(sent[0].subject).toContain('NEX-2026-001'); expect(sent[0].subject).toContain('Nexio Hyper'); expect(sent[0].subject).toContain('₹1,180.00');
    expect(sent[0].text).toContain('NEX-2026-001');
    expect(sent[0].attachments).toHaveLength(1);
    expect(sent[0].attachments![0]).toMatchObject({ filename: 'NEX-2026-001.pdf', contentType: 'application/pdf' });
    expect(Buffer.from(sent[0].attachments![0].content).subarray(0, 4).toString()).toBe('%PDF');
    const [row] = store.listDeliveries(admin, INVOICE);
    expect(row).toMatchObject({ invoiceId: INVOICE, channel: 'email', to: ['billing@nexio.example'], cc: [], status: 'sent', error: '', attemptedBy: admin.id, attemptedByName: admin.name });
    expect(row.subject).toBe(sent[0].subject); expect(Date.parse(row.attemptedAt)).not.toBeNaN();
    expect(result.delivery).toEqual(row);
  });

  it('uses the recipients and message the sender typed, and escapes the message in the html part', async () => {
    configure(admin);
    await sendInvoiceEmail(store, admin, INVOICE, { to: 'ap@acme.example; fin@acme.example', cc: ['boss@acme.example'], message: 'Hi <b>team</b> & co\nSecond line' }, deps);
    expect(sent[0]).toMatchObject({ to: ['ap@acme.example', 'fin@acme.example'], cc: ['boss@acme.example'], text: 'Hi <b>team</b> & co\nSecond line' });
    expect(sent[0].html).toContain('Hi &lt;b&gt;team&lt;/b&gt; &amp; co'); expect(sent[0].html).not.toContain('<b>team</b>');
    expect(store.listDeliveries(admin, INVOICE)[0]).toMatchObject({ to: ['ap@acme.example', 'fin@acme.example'], cc: ['boss@acme.example'] });
  });

  it('follows the customer when the billing email changes, and falls back to the issue-time snapshot', async () => {
    configure(admin);
    const customer = must(store.listCustomers(admin).items[0]);
    store.updateCustomer(admin, customer.id, { companyName: customer.companyName, contactName: customer.contactName, email: 'new-billing@nexio.example', phone: customer.phone, gstin: customer.gstin, billingAddress: customer.billingAddress, invoiceDelivery: customer.invoiceDelivery });
    expect(getInvoiceEmailDefaults(store, admin, INVOICE, deps)).toMatchObject({ to: 'new-billing@nexio.example', configured: true });
    await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(sent[0].to).toEqual(['new-billing@nexio.example']);
  });

  it('offers a prefilled subject and message and says whether email is set up', () => {
    expect(getInvoiceEmailDefaults(store, admin, INVOICE, deps)).toMatchObject({ to: 'billing@nexio.example', configured: false });
    const defaults = getInvoiceEmailDefaults(store, admin, INVOICE, deps);
    expect(defaults.subject).toContain('NEX-2026-001'); expect(defaults.message).toContain('Nexio Hyper'); expect(defaults.message).toContain('₹1,180.00');
  });

  it.each([
    ['a bad recipient', { to: 'not-an-address' }, /^To:/], ['a bad cc', { cc: 'a@b.example, nope' }, /^Cc:/],
    ['a non-text message', { message: 42 }, /message/i], ['an oversized message', { message: 'x'.repeat(5001) }, /message/i], ['a non-object body', 'oops', /invalid/i],
  ])('refuses %s with a 400, before anything is sent or logged', async (_name, input, pattern) => {
    configure(admin);
    const failure = await rejection(sendInvoiceEmail(store, admin, INVOICE, input, deps));
    expect(failure).toBeInstanceOf(MailServiceError); expect((failure as MailServiceError).status).toBe(400); expect((failure as Error).message).toMatch(pattern);
    expect(sent).toEqual([]); expect(renderPdf).not.toHaveBeenCalled(); expect(store.listDeliveries(admin, INVOICE)).toEqual([]);
  });

  it('refuses a void invoice with a 409', async () => {
    configure(admin); store.voidInvoice(admin, INVOICE, 'Issued in error');
    const failure = await rejection(sendInvoiceEmail(store, admin, INVOICE, {}, deps));
    expect(failure).toMatchObject({ status: 409, message: expect.stringMatching(/void/i) });
    expect(sent).toEqual([]); expect(store.listDeliveries(admin, INVOICE)).toEqual([]);
  });

  it('answers not-configured, and logs it, while the tenant has no SMTP host', async () => {
    const result = await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(result).toMatchObject({ status: 'not-configured', message: expect.stringMatching(/not set up|not configured/i) });
    expect(sent).toEqual([]);
    expect(store.listDeliveries(admin, INVOICE)).toMatchObject([{ status: 'not-configured', error: expect.stringMatching(/SMTP/i) }]);
  });

  it('logs a failed send with the clean reason and never repeats the raw SMTP text', async () => {
    configure(admin);
    transportBehaviour = { sendMail: async () => { throw Object.assign(new Error(`535 5.7.8 ${PASSWORD} rejected for billing at 10.1.2.3`), { code: 'EAUTH', responseCode: 535 }); } };
    const result = await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(result.status).toBe('failed');
    const [row] = store.listDeliveries(admin, INVOICE);
    expect(row).toMatchObject({ status: 'failed', error: expect.stringContaining('(EAUTH)') });
    for (const text of [JSON.stringify(result), JSON.stringify(row)]) for (const raw of [PASSWORD, '10.1.2.3', '535 5.7.8']) expect(text).not.toContain(raw);
  });

  it('logs a failure, and sends nothing, when the PDF cannot be rendered', async () => {
    configure(admin); renderPdf.mockRejectedValueOnce(new Error('Chromium exploded at /secret/path'));
    const result = await sendInvoiceEmail(store, admin, INVOICE, {}, deps);
    expect(result).toMatchObject({ status: 'failed', message: expect.stringMatching(/PDF/) });
    expect(sent).toEqual([]); expect(JSON.stringify(result)).not.toContain('/secret/path');
    expect(store.listDeliveries(admin, INVOICE)).toMatchObject([{ status: 'failed' }]);
  });

  it('lets a tenant user send, but not a superadmin, and treats another tenant invoice as missing', async () => {
    configure(admin);
    expect((await sendInvoiceEmail(store, user, INVOICE, {}, deps)).status).toBe('sent');
    expect(store.listDeliveries(user, INVOICE)).toHaveLength(1);
    await expect(sendInvoiceEmail(store, superadmin, INVOICE, {}, deps)).rejects.toBeInstanceOf(Error);
    const foreign = await rejection(sendInvoiceEmail(store, evo, INVOICE, {}, deps));
    expect(foreign).toMatchObject({ status: 404 });
    expect(sent).toHaveLength(1); expect(store.listDeliveries(evo, 'evo-invoice-001')).toEqual([]);
    expect(() => store.listDeliveries(evo, INVOICE)).toThrow();
  });
});

describe('testing the SMTP settings', () => {
  it('reports not-configured, verified or failed truthfully and records the outcome in the logs', async () => {
    expect(await testSmtp(store, admin, deps)).toMatchObject({ status: 'not-configured' });
    configure(admin);
    const ok = await testSmtp(store, admin, deps);
    expect(ok).toMatchObject({ status: 'verified', message: expect.stringContaining('smtp.nexio.example') });
    transportBehaviour = { verify: async () => { throw Object.assign(new Error(`bad ${PASSWORD}`), { code: 'EAUTH' }); } };
    const bad = await testSmtp(store, admin, deps);
    expect(bad).toMatchObject({ status: 'failed', message: expect.stringContaining('(EAUTH)') });
    const logs = store.listOperationalLogs(admin).map((log) => log.message).join('\n');
    expect(logs).toContain('(EAUTH)'); expect(logs).not.toContain(PASSWORD); expect(logs).not.toContain('no external email was sent');
  });

  it('is for tenant admins only', async () => {
    expect(await rejection(testSmtp(store, user, deps))).toMatchObject({ status: 403 });
  });
});

describe('payment reminders', () => {
  it('sends an email reminder to the customer when SMTP is set up, and logs the delivery against the invoice', async () => {
    configure(admin);
    const result = await sendPaymentReminder(store, admin, INVOICE, { channel: 'email', note: 'Please pay by Friday.' }, deps);
    expect(result).toMatchObject({ status: 'sent', reminder: { channel: 'email', note: 'Please pay by Friday.' }, message: expect.stringContaining('sent') });
    expect(sent[0]).toMatchObject({ to: ['billing@nexio.example'] }); expect(sent[0].subject).toMatch(/reminder/i); expect(sent[0].text).toContain('Please pay by Friday.');
    expect(sent[0].attachments ?? []).toEqual([]);
    expect(store.listDeliveries(admin, INVOICE)).toMatchObject([{ status: 'sent', subject: sent[0].subject }]);
    expect(store.listPendingPayments(admin).find((item) => item.id === INVOICE)?.reminders).toHaveLength(1);
  });

  it('records the reminder but says it was not sent when email is not set up or the send fails', async () => {
    const unset = await sendPaymentReminder(store, admin, INVOICE, { channel: 'email' }, deps);
    expect(unset).toMatchObject({ status: 'not-configured', message: expect.stringMatching(/recorded, not sent/i) });
    configure(admin); transportBehaviour = { sendMail: async () => { throw Object.assign(new Error('boom'), { code: 'ECONNECTION' }); } };
    const failed = await sendPaymentReminder(store, admin, INVOICE, { channel: 'email' }, deps);
    expect(failed).toMatchObject({ status: 'failed', message: expect.stringMatching(/recorded, not sent/i) });
    expect(store.listPendingPayments(admin).find((item) => item.id === INVOICE)?.reminders).toHaveLength(2);
    expect(store.listDeliveries(admin, INVOICE).map((row) => row.status).sort()).toEqual(['failed', 'not-configured']);
  });

  it('records a WhatsApp reminder without sending and says so', async () => {
    configure(admin);
    const result = await sendPaymentReminder(store, admin, INVOICE, { channel: 'whatsapp' }, deps);
    expect(result).toMatchObject({ status: 'recorded', message: expect.stringMatching(/recorded, not sent/i), reminder: { channel: 'whatsapp' } });
    expect(sent).toEqual([]); expect(store.listDeliveries(admin, INVOICE)).toEqual([]);
  });

  it('keeps refusing a paid invoice and another tenant invoice', async () => {
    configure(admin);
    await expect(sendPaymentReminder(store, admin, 'nexio-invoice-payment-001', { channel: 'email' }, deps)).rejects.toThrow(/Paid invoices/);
    await expect(sendPaymentReminder(store, evo, INVOICE, { channel: 'email' }, deps)).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});
