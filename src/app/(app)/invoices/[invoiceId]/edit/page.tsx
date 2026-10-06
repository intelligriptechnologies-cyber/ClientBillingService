'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageTitle } from '@/components/ui';
import { useBilling } from '@/state/billing-store';
import { formatMoney, toMinor } from '@/lib/format';

type Row = { id: string; description: string; quantity: string; price: string };
const blankRow = (): Row => ({ id: crypto.randomUUID(), description: '', quantity: '1', price: '' });

export default function EditDraft() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const router = useRouter();
  const { clients, invoices, role, settings, updateDraft } = useBilling();
  const invoice = invoices.find((item) => item.id === invoiceId);
  const [lines, setLines] = useState<Row[]>(() => invoice?.lines.map((line) => ({ id: line.id, description: line.description, quantity: String(line.quantity), price: String(line.unitPriceMinor / 100) })) ?? [blankRow()]);
  const [message, setMessage] = useState('');
  if (!invoice || invoice.status !== 'draft') return <section className="page"><PageTitle eyebrow="Invoices" title="Draft not found"/><p className="notice">Only existing drafts can be edited.</p></section>;
  if (role === 'viewer') return <section className="page"><PageTitle eyebrow="Billing workspace" title="Edit draft"/><p className="notice">Viewer role cannot edit invoices.</p></section>;
  const change = (id: string, key: keyof Row, value: string) => setLines((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * toMinor(line.price), 0);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const result = await updateDraft(invoice.id, { clientId: String(data.get('client')), invoiceDate: String(data.get('invoiceDate')), dueDate: String(data.get('dueDate')), note: String(data.get('note')) || undefined, lines: lines.map((line) => ({ id: line.id, description: line.description, quantity: Number(line.quantity), unitPriceMinor: toMinor(line.price), lineTotalMinor: Number(line.quantity) * toMinor(line.price) })) });
    if (result) setMessage(result); else router.push(`/invoices/${invoice.id}`);
  };
  return <section className="page"><PageTitle eyebrow="Billing workspace" title="Edit draft"/><form onSubmit={submit} className="stack"><div className="panel" style={{ padding: 20 }}><div className="form-grid"><div className="field"><label htmlFor="draft-client">Client</label><select id="draft-client" className="select" name="client" defaultValue={invoice.clientId} required>{clients.filter((client) => client.status === 'active').map((client) => <option key={client.id} value={client.id}>{client.companyName || client.displayName}</option>)}</select></div><div className="field"><label htmlFor="draft-date">Invoice date</label><input id="draft-date" className="input" type="date" name="invoiceDate" defaultValue={invoice.invoiceDate} required/></div><div className="field"><label htmlFor="draft-due-date">Due date</label><input id="draft-due-date" className="input" type="date" name="dueDate" defaultValue={invoice.dueDate} required/></div><div className="field full"><label htmlFor="draft-note">Note</label><textarea id="draft-note" className="textarea" name="note" defaultValue={invoice.note}/></div></div></div><div className="panel"><div className="panel-head"><h2>Line items</h2><button type="button" className="button button-secondary" onClick={() => setLines((items) => [...items, blankRow()])}>Add line</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th className="money">Line total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><input className="input" value={line.description} onChange={(event) => change(line.id, 'description', event.target.value)} aria-label="Line description"/></td><td><input className="input" type="number" min="1" value={line.quantity} onChange={(event) => change(line.id, 'quantity', event.target.value)} aria-label="Line quantity"/></td><td><input className="input" type="number" min="0" step="0.01" value={line.price} onChange={(event) => change(line.id, 'price', event.target.value)} aria-label="Line unit price"/></td><td className="money">{formatMoney(Number(line.quantity || 0) * toMinor(line.price), settings.currencyCode)}</td><td><button type="button" className="button button-secondary" disabled={lines.length === 1} onClick={() => setLines((items) => items.filter((item) => item.id !== line.id))}>Remove</button></td></tr>)}</tbody></table></div><div className="summary-list"><div><span>Draft total</span><strong>{formatMoney(total, settings.currencyCode)}</strong></div></div></div>{message && <p className="notice" role="alert">{message}</p>}<div className="toolbar"><button className="button button-primary">Save changes</button><button type="button" className="button button-secondary" onClick={() => router.back()}>Cancel</button></div></form></section>;
}
