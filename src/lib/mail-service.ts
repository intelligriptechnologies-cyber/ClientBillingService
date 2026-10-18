import { renderInvoiceHtml } from './invoice-html';
import { mailer, parseAddressList, type MailMessage, type Mailer } from './mailer';
import { renderHtmlToPdf } from './pdf-renderer';
import type { AppSession, DeliveryRecord, DeliveryStatus, PaymentReminder, TenantInvoice, createTenantStore } from './tenant-store';

type Store = ReturnType<typeof createTenantStore>;

/** What a caller can do wrong or is not allowed to do, with the HTTP status a route should answer. */
export class MailServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'MailServiceError'; }
}

export type MailDeps = { mailer: Mailer; renderPdf: (invoice: TenantInvoice) => Promise<Uint8Array> };
export const defaultMailDeps: MailDeps = { mailer, renderPdf: (invoice) => renderHtmlToPdf(renderInvoiceHtml(invoice)) };

const MAX_MESSAGE_LENGTH = 5000;
const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const htmlFor = (text: string) => text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('\n');
const fileSafe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_');

function loadInvoice(store: Store, session: AppSession, invoiceId: string): TenantInvoice {
  let invoice: TenantInvoice | null = null;
  try { invoice = store.getInvoice(session, invoiceId); } catch { /* Another tenant's invoice answers the same as a missing one. */ }
  if (!invoice) throw new MailServiceError('Invoice not found.', 404);
  return invoice;
}

function billingEmail(store: Store, session: AppSession, invoice: TenantInvoice): string {
  return store.getCustomer(session, invoice.customerId)?.email.trim() || invoice.snapshot.customerEmail.trim();
}

function invoiceSubject(invoice: TenantInvoice) { return `Invoice ${invoice.invoiceNumber} from ${invoice.snapshot.companyName} (${money(invoice.totalMinor)})`; }
function invoiceMessage(invoice: TenantInvoice) {
  const { companyName } = invoice.snapshot;
  return `Hello ${invoice.customerName},\n\nPlease find attached invoice ${invoice.invoiceNumber} from ${companyName} for ${money(invoice.totalMinor)}, due on ${invoice.dueDate}.\n\nThank you for your business.\n${companyName}`;
}

export type InvoiceEmailDefaults = { to: string; subject: string; message: string; configured: boolean };

/** What the send dialog starts from. `configured` is false while the tenant has no usable SMTP settings. */
export function getInvoiceEmailDefaults(store: Store, session: AppSession, invoiceId: string, deps: MailDeps = defaultMailDeps): InvoiceEmailDefaults {
  const invoice = loadInvoice(store, session, invoiceId);
  return { to: billingEmail(store, session, invoice), subject: invoiceSubject(invoice), message: invoiceMessage(invoice), configured: deps.mailer.isConfigured(store.getSmtpSettings(session)) };
}

function parseSendInput(input: unknown, fallbackTo: string) {
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) throw new MailServiceError('Invalid request.', 400);
  const body = (input ?? {}) as Record<string, unknown>;
  const to = parseAddressList(body.to, 'To'); if (!to.ok) throw new MailServiceError(to.message, 400);
  const cc = parseAddressList(body.cc, 'Cc'); if (!cc.ok) throw new MailServiceError(cc.message, 400);
  let recipients = to.addresses;
  if (!recipients.length) {
    const fallback = parseAddressList(fallbackTo, 'To'); if (!fallback.ok) throw new MailServiceError(fallback.message, 400);
    recipients = fallback.addresses;
  }
  if (!recipients.length) throw new MailServiceError('To: enter a recipient.', 400);
  if (body.message !== undefined && body.message !== null && typeof body.message !== 'string') throw new MailServiceError('The message must be text.', 400);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > MAX_MESSAGE_LENGTH) throw new MailServiceError(`The message is too long (${MAX_MESSAGE_LENGTH} characters at most).`, 400);
  return { to: recipients, cc: cc.addresses.filter((address) => !recipients.some((item) => item.toLowerCase() === address.toLowerCase())), message };
}

export type SendInvoiceResult = { status: DeliveryStatus; message: string; delivery: DeliveryRecord };

export async function sendInvoiceEmail(store: Store, session: AppSession, invoiceId: string, input: unknown, deps: MailDeps = defaultMailDeps): Promise<SendInvoiceResult> {
  const invoice = loadInvoice(store, session, invoiceId);
  if (invoice.status === 'void') throw new MailServiceError('A void invoice cannot be emailed.', 409);
  const { to, cc, message } = parseSendInput(input, billingEmail(store, session, invoice));
  const smtp = store.getSmtpSettings(session);
  const subject = invoiceSubject(invoice); const text = message || invoiceMessage(invoice);
  const record = (status: DeliveryStatus, error: string) => store.recordDelivery(session, { invoiceId, to, cc, subject, status, error });
  const finish = (status: DeliveryStatus, reason: string, summary: string): SendInvoiceResult => {
    const delivery = record(status, reason);
    store.logFeatureFlow(session, `Invoice ${invoice.invoiceNumber} email to ${to.join(', ')}: ${status}${reason ? ` (${reason})` : ''}`);
    return { status, message: summary, delivery };
  };

  if (!deps.mailer.isConfigured(smtp)) {
    const result = await deps.mailer.sendMail({ from: smtp.from, to, cc, subject, text }, smtp);
    const reason = result.status === 'sent' ? '' : result.reason;
    return finish('not-configured', reason, `The invoice was not sent. ${reason}`);
  }
  let pdf: Uint8Array;
  try { pdf = await deps.renderPdf(invoice); }
  catch { return finish('failed', 'The invoice PDF could not be generated.', 'The invoice was not sent because its PDF could not be generated. Try again in a moment.'); }
  const mail: MailMessage = { from: smtp.from.trim(), to, cc, subject, text, html: htmlFor(text), attachments: [{ filename: `${fileSafe(invoice.invoiceNumber)}.pdf`, content: pdf, contentType: 'application/pdf' }] };
  const result = await deps.mailer.sendMail(mail, smtp);
  if (result.status === 'sent') return finish('sent', '', `Invoice ${invoice.invoiceNumber} was emailed to ${to.join(', ')}.`);
  return finish(result.status, result.reason, `The invoice was not sent. ${result.reason}`);
}

export type SmtpTestResult = { status: 'verified' | 'failed' | 'not-configured'; message: string };

export async function testSmtp(store: Store, session: AppSession, deps: MailDeps = defaultMailDeps): Promise<SmtpTestResult> {
  if (session.role !== 'admin' || !session.tenantId) throw new MailServiceError('Only a tenant admin can test SMTP.', 403);
  const result = await deps.mailer.verify(store.getSmtpSettings(session));
  const outcome: SmtpTestResult = result.status === 'verified' ? { status: 'verified', message: `SMTP test passed. ${result.detail}` } : result.status === 'failed' ? { status: 'failed', message: `SMTP test failed. ${result.reason}` } : { status: 'not-configured', message: result.reason };
  store.logFeatureFlow(session, outcome.message);
  return outcome;
}

export type ReminderResult = { reminder: PaymentReminder; status: DeliveryStatus | 'recorded'; message: string };

/** Records the reminder, then emails it when the channel is email and SMTP works. The message always says whether anything left the building. */
export async function sendPaymentReminder(store: Store, session: AppSession, invoiceId: string, input: { channel: PaymentReminder['channel']; note?: string }, deps: MailDeps = defaultMailDeps): Promise<ReminderResult> {
  const reminder = store.recordPaymentReminder(session, invoiceId, input);
  if (input.channel !== 'email') return { reminder, status: 'recorded', message: 'WhatsApp reminder recorded, not sent. Sending over WhatsApp is not available yet.' };
  const invoice = loadInvoice(store, session, invoiceId);
  const to = [billingEmail(store, session, invoice)]; const smtp = store.getSmtpSettings(session);
  const outstanding = invoice.totalMinor - invoice.paidMinor; const note = input.note?.trim();
  const subject = `Payment reminder: invoice ${invoice.invoiceNumber} from ${invoice.snapshot.companyName}`;
  const text = `Hello ${invoice.customerName},\n\nThis is a reminder that invoice ${invoice.invoiceNumber} from ${invoice.snapshot.companyName} (${money(invoice.totalMinor)}, ${money(outstanding)} outstanding) was due on ${invoice.dueDate}.${note ? `\n\n${note}` : ''}\n\nThank you,\n${invoice.snapshot.companyName}`;
  const result = await deps.mailer.sendMail({ from: smtp.from.trim(), to, cc: [], subject, text, html: htmlFor(text) }, smtp);
  const status: DeliveryStatus = result.status;
  store.recordDelivery(session, { invoiceId, to, cc: [], subject, status, error: result.status === 'sent' ? '' : result.reason });
  store.logFeatureFlow(session, `Payment reminder email for ${invoice.invoiceNumber}: ${status}${result.status === 'sent' ? '' : ` (${result.reason})`}`);
  return { reminder, status, message: result.status === 'sent' ? `Email reminder sent to ${to.join(', ')}.` : `Reminder recorded, not sent. ${result.reason}` };
}
