'use client';

import { apiFetch } from '@/lib/api-client';
import { useState } from 'react';
import { reportClientException } from '@/lib/client-error';

export type InvoiceEmailDefaults = { to: string; subject: string; message: string; configured: boolean };

/** Sends the invoice PDF by email. The server owns the subject, so the dialog only shows it. */
export function InvoiceEmailDialog({ invoiceId, invoiceNumber, defaults, onClose, onAttempted }: { invoiceId: string; invoiceNumber: string; defaults: InvoiceEmailDefaults; onClose(): void; onAttempted(result: { ok: boolean; message: string }): void }) {
  const [to, setTo] = useState(defaults.to); const [cc, setCc] = useState(''); const [message, setMessage] = useState(defaults.message);
  const [error, setError] = useState(''); const [sending, setSending] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSending(true);
    try {
      const response = await apiFetch(`/api/invoices/${invoiceId}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, cc, message }) });
      const body = await response.json() as { message?: string };
      const text = body.message ?? (response.ok ? 'Invoice sent.' : 'Unable to send the invoice.');
      onAttempted({ ok: response.ok, message: text });
      if (response.ok) onClose(); else setError(text);
    } catch (cause) { reportClientException('Send invoice by email', cause); setError('Unable to send the invoice.'); }
    finally { setSending(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><form className="dialog" role="dialog" aria-modal="true" aria-label="Send invoice by email" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
    <div className="dialog-head"><h2>Send {invoiceNumber} by email</h2><button className="icon-button" type="button" aria-label="Close email dialog" onClick={onClose}>×</button></div>
    {!defaults.configured && <p className="notice" role="note">Email is not set up for this company yet. An admin can add the SMTP host and From address under Settings, Email.</p>}
    <label className="field"><span>To</span><input className="input" type="text" inputMode="email" autoComplete="off" required value={to} onChange={(event) => setTo(event.target.value)} /></label>
    <label className="field"><span>Cc</span><input className="input" type="text" inputMode="email" autoComplete="off" placeholder="Optional, separate addresses with commas" value={cc} onChange={(event) => setCc(event.target.value)} /></label>
    <p className="subtle">Subject: {defaults.subject}</p>
    <label className="field"><span>Message</span><textarea className="textarea" rows={8} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
    <p className="hint">The invoice PDF is attached.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="toolbar dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={sending || !defaults.configured || !to.trim()}>{sending ? 'Sending...' : 'Send email'}</button></div>
  </form></div>;
}
