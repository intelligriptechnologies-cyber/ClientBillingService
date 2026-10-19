import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createTransport } from 'nodemailer';

/**
 * The one door out for email. `sendMail` and `verify` take a message and a tenant's SMTP settings and
 * always resolve to a typed result, so callers branch on `status` and never see a raw SMTP error.
 * Two implementations sit behind it, chosen by CLIENT_BILLING_MAIL_TRANSPORT: the real SMTP transport
 * (the default) and a capture transport that appends messages to a JSON file for tests.
 */
export type MailAttachment = { filename: string; content: Uint8Array; contentType: string };
export type MailMessage = { from: string; to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] };
export type SmtpSettings = { host: string; port: number; user: string; password: string; from: string };

export type MailResult =
  | { status: 'sent'; messageId: string }
  | { status: 'failed'; reason: string }
  | { status: 'not-configured'; reason: string };
export type VerifyResult =
  | { status: 'verified'; detail: string }
  | { status: 'failed'; reason: string }
  | { status: 'not-configured'; reason: string };

export type Mailer = {
  sendMail(message: MailMessage, smtp: SmtpSettings | null): Promise<MailResult>;
  verify(smtp: SmtpSettings | null): Promise<VerifyResult>;
  isConfigured(smtp: SmtpSettings | null): boolean;
};

/** The slice of a nodemailer transporter the mailer uses, so tests can pass a fake. */
export type SmtpTransport = {
  sendMail(mail: { from: string; to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: MailAttachment[] }): Promise<{ messageId: string }>;
  verify(): Promise<unknown>;
};
export type MailerDeps = { env?: Record<string, string | undefined>; createTransport?: (options: Record<string, unknown>) => SmtpTransport };

const MAX_ADDRESSES = 10;
const local = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const label = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const addressPattern = new RegExp(`^(${local})@(${label}(?:\\.${label})+)$`);

export function isValidAddress(value: string): boolean {
  const match = addressPattern.exec(value);
  return Boolean(match) && value.length <= 254 && match![1].length <= 64;
}

export type AddressListResult = { ok: true; addresses: string[] } | { ok: false; message: string };

/** Plain addresses only, so a display name or a line break can never smuggle in another header or recipient. */
export function parseAddressList(input: unknown, field: string): AddressListResult {
  if (input === undefined || input === null) return { ok: true, addresses: [] };
  let parts: unknown[];
  if (typeof input === 'string') parts = input.split(/[,;]/);
  else if (Array.isArray(input)) parts = input;
  else return { ok: false, message: `${field}: enter email addresses as text.` };
  const addresses: string[] = []; const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part !== 'string') return { ok: false, message: `${field}: enter email addresses as text.` };
    const address = part.trim();
    if (!address) continue;
    if (!isValidAddress(address)) return { ok: false, message: `${field}: "${address.slice(0, 60)}" is not a valid email address.` };
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase()); addresses.push(address);
  }
  if (addresses.length > MAX_ADDRESSES) return { ok: false, message: `${field}: enter at most ${MAX_ADDRESSES} addresses.` };
  return { ok: true, addresses };
}

const reasons: Record<string, string> = {
  EAUTH: 'The mail server rejected the sign-in', ENOAUTH: 'The mail server rejected the sign-in', EOAUTH2: 'The mail server rejected the sign-in',
  ECONNECTION: 'Could not connect to the mail server', ESOCKET: 'Could not connect to the mail server', ECONNREFUSED: 'Could not connect to the mail server', ECONNRESET: 'Could not connect to the mail server', EHOSTUNREACH: 'Could not connect to the mail server', ENETUNREACH: 'Could not connect to the mail server',
  ETIMEDOUT: 'The connection to the mail server timed out',
  EDNS: 'Could not find the mail server', ENOTFOUND: 'Could not find the mail server', EAI_AGAIN: 'Could not find the mail server',
  ETLS: 'The secure connection to the mail server failed', EREQUIRETLS: 'The mail server does not offer a secure connection',
  EENVELOPE: 'The mail server rejected the sender or a recipient address',
  EPROTOCOL: 'The mail server sent an unexpected reply',
};
const fallbackReason = 'The mail server did not accept the message';

/** Maps any transport error to a fixed sentence plus its error code. Nothing from the server's own text reaches the caller. */
export function describeMailError(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' && /^[A-Z0-9_]{3,20}$/.test(cause.code) ? cause.code : null;
  const reason = (code && reasons[code]) || fallbackReason;
  return code && reasons[code] ? `${reason} (${code}).` : `${reason}.`;
}

const NOT_SET_UP = 'Email is not set up. Add an SMTP host and a From address under Settings, Email.';

function configurationProblem(smtp: SmtpSettings | null): string | null {
  if (!smtp || !smtp.host.trim() || !smtp.from.trim()) return NOT_SET_UP;
  if (!isValidAddress(smtp.from.trim())) return 'The From address under Settings, Email is not a valid email address.';
  return null;
}

function transportOptions(smtp: SmtpSettings): Record<string, unknown> {
  const secure = smtp.port === 465;
  return {
    host: smtp.host.trim(), port: smtp.port, secure,
    // Credentials only travel over TLS: a server that offers no STARTTLS makes the send fail instead of exposing the password.
    requireTLS: Boolean(smtp.user) && !secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  };
}

function nodemailerTransport(options: Record<string, unknown>): SmtpTransport {
  const transport = createTransport(options);
  return {
    async sendMail(mail) {
      const info = await transport.sendMail({ ...mail, attachments: mail.attachments?.map((item) => ({ filename: item.filename, content: Buffer.from(item.content), contentType: item.contentType })) });
      if (Array.isArray(info.rejected) && info.rejected.length > 0) throw Object.assign(new Error('Recipient rejected'), { code: 'EENVELOPE' });
      return { messageId: String(info.messageId) };
    },
    verify: () => transport.verify(),
  };
}

function captureFile(env: Record<string, string | undefined>): string {
  return env.CLIENT_BILLING_MAIL_CAPTURE_FILE || resolve('.data', 'mail-capture.json');
}

function appendCaptured(file: string, entry: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  let captured: unknown[] = [];
  try { const parsed: unknown = JSON.parse(readFileSync(file, 'utf8')); if (Array.isArray(parsed)) captured = parsed; } catch { /* First message, or an unreadable file that the next write replaces. */ }
  captured.push(entry);
  writeFileSync(file, JSON.stringify(captured, null, 2));
}

export function createMailer(deps: MailerDeps = {}): Mailer {
  const environment = () => deps.env ?? process.env;
  const open = (smtp: SmtpSettings) => (deps.createTransport ?? nodemailerTransport)(transportOptions(smtp));
  const captureBlocked = (env: Record<string, string | undefined>) => env.CLIENT_BILLING_ENV === 'production' ? 'The capture transport is for tests and is switched off in production.' : null;
  const problem = (smtp: SmtpSettings | null) => {
    const env = environment();
    return (env.CLIENT_BILLING_MAIL_TRANSPORT === 'capture' ? captureBlocked(env) : null) ?? configurationProblem(smtp);
  };

  return {
    isConfigured: (smtp) => problem(smtp) === null,

    async sendMail(message, smtp) {
      const blocked = problem(smtp);
      if (blocked || !smtp) return { status: 'not-configured', reason: blocked ?? NOT_SET_UP };
      const env = environment();
      if (env.CLIENT_BILLING_MAIL_TRANSPORT === 'capture') {
        try {
          const messageId = `<capture-${crypto.randomUUID()}@ledgerly.invalid>`;
          appendCaptured(captureFile(env), {
            capturedAt: new Date().toISOString(), messageId, from: message.from, to: message.to, cc: message.cc ?? [], subject: message.subject, text: message.text, html: message.html ?? null,
            attachments: (message.attachments ?? []).map((item) => ({ filename: item.filename, contentType: item.contentType, size: item.content.length, contentBase64: Buffer.from(item.content).toString('base64') })),
          });
          return { status: 'sent', messageId };
        } catch { return { status: 'failed', reason: 'The capture file could not be written.' }; }
      }
      try {
        const info = await open(smtp).sendMail({ from: message.from, to: message.to, cc: message.cc, subject: message.subject, text: message.text, html: message.html, attachments: message.attachments });
        return { status: 'sent', messageId: info.messageId };
      } catch (cause) { return { status: 'failed', reason: describeMailError(cause) }; }
    },

    async verify(smtp) {
      const blocked = problem(smtp);
      if (blocked || !smtp) return { status: 'not-configured', reason: blocked ?? NOT_SET_UP };
      if (environment().CLIENT_BILLING_MAIL_TRANSPORT === 'capture') return { status: 'verified', detail: `The capture transport is active, so no connection was made to ${smtp.host.trim()}. Messages are written to a file and nothing is sent.` };
      try {
        await open(smtp).verify();
        return { status: 'verified', detail: `Connected to ${smtp.host.trim()}:${smtp.port} and the server accepted the settings.` };
      } catch (cause) { return { status: 'failed', reason: describeMailError(cause) }; }
    },
  };
}

export const mailer: Mailer = createMailer();
