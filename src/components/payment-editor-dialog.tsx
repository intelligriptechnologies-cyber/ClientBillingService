'use client';

import { apiFetch } from '@/lib/api-client';
import { useState } from 'react';
import { reportClientException } from '@/lib/client-error';
import type { PaymentMethod, TenantPayment } from '@/lib/tenant-store';

export function PaymentEditorDialog({ payment, onClose, onSaved }: { payment: TenantPayment; onClose(): void; onSaved(): void }) {
  const [method, setMethod] = useState<PaymentMethod>(payment.method);
  const [reference, setReference] = useState(payment.reference);
  const [notes, setNotes] = useState(payment.notes);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const response = await apiFetch(`/api/payments/${payment.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, reference, notes }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Unable to update payment.');
      onSaved(); onClose();
    } catch (cause) { reportClientException('Update payment details', cause); setError(cause instanceof Error ? cause.message : 'Unable to update payment.'); }
    finally { setSaving(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><form className="dialog" role="dialog" aria-modal="true" aria-label="Edit payment details" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
    <div className="dialog-head"><h2>Edit payment details</h2><button className="icon-button" type="button" aria-label="Close payment editor" onClick={onClose}>×</button></div>
    <p className="subtle">{payment.invoiceNumber} · {payment.customerName}. The recorded amount and allocation remain fixed.</p>
    <label className="field"><span>Method</span><select className="select" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{['bank_transfer', 'cash', 'card', 'cheque', 'other'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label>
    <label className="field"><span>Reference</span><input className="input" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
    <label className="field"><span>Notes</span><textarea className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="toolbar dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save details'}</button></div>
  </form></div>;
}
