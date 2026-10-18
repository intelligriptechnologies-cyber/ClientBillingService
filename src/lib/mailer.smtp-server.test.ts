import type { AddressInfo } from 'node:net';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailer, type MailMessage, type SmtpSettings } from '@/lib/mailer';

// A real SMTP conversation against a local smtp-server. It proves the nodemailer wiring (STARTTLS, auth,
// MIME attachment) works, not that any provider accepts the settings.
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const message: MailMessage = { from: 'billing@nexio.example', to: ['client@acme.example'], cc: ['boss@acme.example'], subject: 'Invoice NEX-1 from Nexio', text: 'Please find the invoice attached.', attachments: [{ filename: 'NEX-1.pdf', content: pdf, contentType: 'application/pdf' }] };

let server: SMTPServer | undefined;
const received: Array<{ raw: string; user: string | undefined; to: string[] }> = [];

async function listen(options: SMTPServerOptions = {}) {
  server = new SMTPServer({
    logger: false,
    onAuth(auth, _session, done) { if (auth.username === 'billing' && auth.password === 'right-password') done(null, { user: auth.username }); else done(new Error('Invalid username or password')); },
    onData(stream, session, done) {
      const chunks: Buffer[] = []; stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => { received.push({ raw: Buffer.concat(chunks).toString('utf8'), user: typeof session.user === 'string' ? session.user : undefined, to: session.envelope.rcptTo.map((item) => item.address) }); done(); });
    },
    ...options,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.server.address() as AddressInfo).port;
}
const settings = (port: number, extra: Partial<SmtpSettings> = {}): SmtpSettings => ({ host: '127.0.0.1', port, user: 'billing', password: 'right-password', from: 'billing@nexio.example', ...extra });

beforeEach(() => { received.length = 0; vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0'); });
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); server = undefined; });

describe('real SMTP exchange against a local smtp-server', () => {
  it('upgrades with STARTTLS, signs in, and delivers the message with the PDF attached intact', async () => {
    const port = await listen();
    const mailer = createMailer({ env: {} });
    const result = await mailer.sendMail(message, settings(port));
    expect(result.status).toBe('sent');
    expect(received).toHaveLength(1);
    expect(received[0].user).toBe('billing');
    expect(received[0].to.sort()).toEqual(['boss@acme.example', 'client@acme.example']);
    const raw = received[0].raw;
    expect(raw).toContain('Subject: Invoice NEX-1 from Nexio');
    expect(raw).toMatch(/Content-Type: application\/pdf; name=("?)NEX-1\.pdf\1/i);
    const encoded = raw.split(/filename="?NEX-1\.pdf"?\r?\n\r?\n/i)[1].split(/\r?\n--/)[0].replace(/\s+/g, '');
    expect(Buffer.from(encoded, 'base64').equals(pdf)).toBe(true);
  });

  it('verify passes with the right password and reports a clean sign-in failure with the wrong one', async () => {
    const port = await listen(); const mailer = createMailer({ env: {} });
    expect((await mailer.verify(settings(port))).status).toBe('verified');
    const wrong = await mailer.verify(settings(port, { password: 'wrong-password' }));
    expect(wrong).toMatchObject({ status: 'failed' });
    if (wrong.status === 'failed') { expect(wrong.reason).toMatch(/sign-in/i); expect(wrong.reason).not.toContain('wrong-password'); }
    expect(received).toHaveLength(0);
  });

  it('sends without credentials to a server that needs none, and never offers the password over an unencrypted link', async () => {
    const port = await listen({ authOptional: true, disabledCommands: ['STARTTLS', 'AUTH'] });
    const mailer = createMailer({ env: {} });
    expect((await mailer.sendMail(message, settings(port, { user: '', password: '' }))).status).toBe('sent');
    const withPassword = await mailer.sendMail(message, settings(port));
    expect(withPassword.status).toBe('failed');
    expect(received).toHaveLength(1);
  });

  it('reports a clean connection failure when nothing is listening', async () => {
    const port = await listen(); await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined;
    const result = await createMailer({ env: {} }).sendMail(message, settings(port));
    expect(result).toMatchObject({ status: 'failed' });
    if (result.status === 'failed') { expect(result.reason).toMatch(/connect/i); expect(result.reason).not.toContain('127.0.0.1'); }
  });
});
