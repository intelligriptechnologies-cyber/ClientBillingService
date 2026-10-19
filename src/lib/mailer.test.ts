import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailer, parseAddressList, type MailMessage, type SmtpSettings, type SmtpTransport } from '@/lib/mailer';

const smtp: SmtpSettings = { host: 'smtp.example.test', port: 587, user: 'billing', password: 'hunter2-secret', from: 'billing@nexio.example' };
const pdf = new TextEncoder().encode('%PDF-1.4 fake invoice');
const message: MailMessage = { from: smtp.from, to: ['client@acme.example'], cc: ['boss@acme.example'], subject: 'Invoice NEX-1', text: 'Hello', html: '<p>Hello</p>', attachments: [{ filename: 'NEX-1.pdf', content: pdf, contentType: 'application/pdf' }] };

type Sent = Parameters<SmtpTransport['sendMail']>[0];
function fakeTransport(overrides: Partial<SmtpTransport> = {}) {
  const sent: Sent[] = []; const created: Array<Record<string, unknown>> = [];
  const factory = vi.fn((options: Record<string, unknown>): SmtpTransport => {
    created.push(options);
    return { sendMail: async (mail) => { sent.push(mail); return { messageId: '<id-1@fake>' }; }, verify: async () => true, ...overrides };
  });
  return { sent, created, factory };
}

describe('parseAddressList', () => {
  it('accepts a string or an array, trims, splits on comma and semicolon, and drops duplicates ignoring case', () => {
    expect(parseAddressList(' A@x.example, b@x.example;a@X.example ', 'To')).toEqual({ ok: true, addresses: ['A@x.example', 'b@x.example'] });
    expect(parseAddressList(['a@x.example', ' b@x.example '], 'To')).toEqual({ ok: true, addresses: ['a@x.example', 'b@x.example'] });
  });

  it('treats blank, null and undefined as an empty list', () => {
    for (const empty of [undefined, null, '', '  ', []]) expect(parseAddressList(empty, 'Cc')).toEqual({ ok: true, addresses: [] });
  });

  it.each([
    ['no at sign', 'client.example'], ['no domain dot', 'a@localhost'], ['display name', 'Acme <a@x.example>'], ['space inside', 'a b@x.example'],
    ['header injection with CRLF', 'a@x.example\r\nBcc: evil@x.example'], ['empty local part', '@x.example'], ['leading dot domain', 'a@.x.example'],
    ['double dot', 'a@x..example'], ['trailing hyphen label', 'a@x-.example'],
  ])('rejects %s and names the field', (_name, bad) => {
    const result = parseAddressList(bad, 'Cc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/^Cc:/);
  });

  it('rejects non-text entries, overlong addresses and more than ten recipients', () => {
    expect(parseAddressList([42], 'To').ok).toBe(false);
    expect(parseAddressList({ a: 1 }, 'To').ok).toBe(false);
    expect(parseAddressList(`${'a'.repeat(65)}@x.example`, 'To').ok).toBe(false);
    expect(parseAddressList(Array.from({ length: 11 }, (_, index) => `u${index}@x.example`), 'To').ok).toBe(false);
    expect(parseAddressList(Array.from({ length: 10 }, (_, index) => `u${index}@x.example`), 'To').ok).toBe(true);
  });
});

describe('smtp transport', () => {
  it('sends through the tenant settings and reports the message id', async () => {
    const { sent, created, factory } = fakeTransport();
    const result = await createMailer({ env: {}, createTransport: factory }).sendMail(message, smtp);
    expect(result).toEqual({ status: 'sent', messageId: '<id-1@fake>' });
    expect(created[0]).toMatchObject({ host: 'smtp.example.test', port: 587, secure: false, requireTLS: true, auth: { user: 'billing', pass: 'hunter2-secret' } });
    expect(sent[0]).toMatchObject({ from: 'billing@nexio.example', to: ['client@acme.example'], cc: ['boss@acme.example'], subject: 'Invoice NEX-1', text: 'Hello', html: '<p>Hello</p>' });
    expect(sent[0].attachments?.[0]).toMatchObject({ filename: 'NEX-1.pdf', contentType: 'application/pdf' });
    expect(Buffer.from(sent[0].attachments![0].content).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('uses implicit TLS on port 465 and sends no credentials, and does not require STARTTLS, when no user is set', async () => {
    const tls = fakeTransport(); await createMailer({ env: {}, createTransport: tls.factory }).sendMail(message, { ...smtp, port: 465 });
    expect(tls.created[0]).toMatchObject({ secure: true });
    const open = fakeTransport(); await createMailer({ env: {}, createTransport: open.factory }).sendMail(message, { ...smtp, user: '', password: '' });
    expect(open.created[0]).toMatchObject({ requireTLS: false }); expect(open.created[0]).not.toHaveProperty('auth');
  });

  it('answers not-configured, without opening a connection, when the host or sender is blank or the sender is not an address', async () => {
    const { factory } = fakeTransport(); const mailer = createMailer({ env: {}, createTransport: factory });
    for (const broken of [{ ...smtp, host: '  ' }, { ...smtp, from: '' }, { ...smtp, from: 'not an address' }]) {
      const result = await mailer.sendMail({ ...message, from: broken.from }, broken);
      expect(result.status).toBe('not-configured');
      expect(mailer.isConfigured(broken)).toBe(false);
    }
    expect((await mailer.sendMail(message, null)).status).toBe('not-configured');
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'EAUTH', responseCode: 535, message: 'Invalid login: 535 5.7.8 hunter2-secret rejected for billing' }, /sign-in/i, 'EAUTH'],
    [{ code: 'ECONNECTION', message: 'connect ECONNREFUSED 10.0.0.5:587' }, /connect/i, 'ECONNECTION'],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, /timed out/i, 'ETIMEDOUT'],
    [{ code: 'EENVELOPE', message: 'No recipients defined: 550 mailbox client@acme.example unavailable' }, /address/i, 'EENVELOPE'],
    [{ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.example.test' }, /find|resolve/i, 'EDNS'],
    [{ message: 'something with hunter2-secret inside' }, /did not accept/i, null],
  ])('turns a transport error into a failed result with a clean reason and no raw text: %o', async (cause, reason, code) => {
    const { factory } = fakeTransport({ sendMail: async () => { throw Object.assign(new Error(cause.message), cause); } });
    const result = await createMailer({ env: {}, createTransport: factory }).sendMail(message, smtp);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toMatch(reason);
    if (code) expect(result.reason).toContain(`(${code})`); else expect(result.reason).not.toContain('(');
    for (const secret of ['hunter2-secret', '10.0.0.5', 'client@acme.example', 'ECONNREFUSED', 'getaddrinfo']) expect(result.reason).not.toContain(secret);
  });

  it('verify opens the connection once and reports verified or a clean failure', async () => {
    const ok = fakeTransport(); expect(await createMailer({ env: {}, createTransport: ok.factory }).verify(smtp)).toEqual({ status: 'verified', detail: 'Connected to smtp.example.test:587 and the server accepted the settings.' });
    const bad = fakeTransport({ verify: async () => { throw Object.assign(new Error('535 hunter2-secret'), { code: 'EAUTH' }); } });
    const result = await createMailer({ env: {}, createTransport: bad.factory }).verify(smtp);
    expect(result.status).toBe('failed'); expect(JSON.stringify(result)).not.toContain('hunter2-secret');
    expect((await createMailer({ env: {}, createTransport: ok.factory }).verify({ ...smtp, host: '' })).status).toBe('not-configured');
  });
});

describe('capture transport', () => {
  let directory: string; let file: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'mail-capture-')); file = join(directory, 'mail-capture.json'); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const env = () => ({ CLIENT_BILLING_MAIL_TRANSPORT: 'capture', CLIENT_BILLING_MAIL_CAPTURE_FILE: file });

  it('appends each message to the JSON file with attachments as base64 and never opens a connection', async () => {
    const { factory } = fakeTransport(); const mailer = createMailer({ env: env(), createTransport: factory });
    const first = await mailer.sendMail(message, smtp); const second = await mailer.sendMail({ ...message, subject: 'Second' }, smtp);
    expect(first.status).toBe('sent'); expect(second.status).toBe('sent');
    expect(factory).not.toHaveBeenCalled();
    const captured = JSON.parse(readFileSync(file, 'utf8')) as Array<{ subject: string; from: string; to: string[]; cc: string[]; text: string; attachments: Array<{ filename: string; contentType: string; size: number; contentBase64: string }> }>;
    expect(captured.map((item) => item.subject)).toEqual(['Invoice NEX-1', 'Second']);
    expect(captured[0]).toMatchObject({ from: 'billing@nexio.example', to: ['client@acme.example'], cc: ['boss@acme.example'], text: 'Hello' });
    expect(captured[0].attachments[0]).toMatchObject({ filename: 'NEX-1.pdf', contentType: 'application/pdf', size: pdf.length });
    expect(Buffer.from(captured[0].attachments[0].contentBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(JSON.stringify(captured)).not.toContain('hunter2-secret');
  });

  it('keeps the same configuration gate as the real transport', async () => {
    const mailer = createMailer({ env: env(), createTransport: fakeTransport().factory });
    expect((await mailer.sendMail(message, { ...smtp, host: '' })).status).toBe('not-configured');
    expect(existsSync(file)).toBe(false);
  });

  it('verify succeeds without a connection and says the capture transport is active', async () => {
    const result = await createMailer({ env: env(), createTransport: fakeTransport().factory }).verify(smtp);
    expect(result).toMatchObject({ status: 'verified' }); if (result.status === 'verified') expect(result.detail).toMatch(/capture/i);
  });

  it('puts the file under .data in the working directory when no file is named', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    try {
      await createMailer({ env: { CLIENT_BILLING_MAIL_TRANSPORT: 'capture' }, createTransport: fakeTransport().factory }).sendMail(message, smtp);
    } finally { cwd.mockRestore(); }
    expect(existsSync(join(directory, '.data', 'mail-capture.json'))).toBe(true);
  });

  it('refuses to run in production', async () => {
    const result = await createMailer({ env: { ...env(), CLIENT_BILLING_ENV: 'production' }, createTransport: fakeTransport().factory }).sendMail(message, smtp);
    expect(result.status).toBe('not-configured'); expect(existsSync(file)).toBe(false);
  });
});

