'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageTitle } from '@/components/ui';
import { useBilling } from '@/state/billing-store';
import { formatMoney, toMinor } from '@/lib/format';

type Row = { id: string; description: string; quantity: string; price: string };
const createRow = (): Row => ({ id: crypto.randomUUID(), description: '', quantity: '1', price: '' });

export default function NewInvoice() {
  const { clients, role, settings, createDraft } = useBilling();
  const router = useRouter();
  const [lines, setLines] = useState<Row[]>([createRow()]);
  const [message, setMessage] = useState('');
  const change = (id: string, key: keyof Row, value: string) => setLines((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * toMinor(line.price), 0);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const result = await createDraft({ clientId: String(data.get('client')), invoiceDate: String(data.get('invoiceDate')), dueDate: String(data.get('dueDate')), note: String(data.get('note')) || undefined, lines: lines.map((line) => ({ id: line.id, description: line.description, quantity: Number(line.quantity), unitPriceMinor: toMinor(line.price), lineTotalMinor: Number(line.quantity) * toMinor(line.price) })) });
    if (result) setMessage(result); else router.push('/invoices');
  };
  if (role === 'viewer') return <section className="page"><PageTitle eyebrow="Billing workspace" title="Create invoice"/><p className="notice">Viewer role cannot create invoices.</p></section>;
  return <section className="page"><PageTitle eyebrow="Billing workspace" title="Create draft"/><form onSubmit={submit} className="stack"><div className="panel" style={{ padding: 20 }}><div className="form-grid"><div className="field"><label htmlFor="invoice-client">Client</label><select id="invoice-client" className="select" name="client" defaultValue="" required><option value="">Select active client</option>{clients.filter((client) => client.status === 'active').map((client) => <option key={client.id} value={client.id}>{client.companyName || client.displayName}</option>)}</select></div><div className="field"><label htmlFor="invoice-date">Invoice date</label><input id="invoice-date" className="input" type="date" name="invoiceDate" defaultValue="2026-10-06" required/></div><div className="field"><label htmlFor="invoice-due-date">Due date</label><input id="invoice-due-date" className="input" type="date" name="dueDate" defaultValue="2026-10-20" required/></div><div className="field full"><label htmlFor="invoice-note">Note</label><textarea id="invoice-note" className="textarea" name="note"/></div></div></div><div className="panel"><div className="panel-head"><h2>Line items</h2><button type="button" className="button button-secondary" onClick={() => setLines((items) => [...items, createRow()])}>Add line</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th className="money">Line total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><input className="input" value={line.description} onChange={(event) => change(line.id, 'description', event.target.value)} aria-label="Line description"/></td><td><input className="input" type="number" min="1" value={line.quantity} onChange={(event) => change(line.id, 'quantity', event.target.value)} aria-label="Line quantity"/></td><td><input className="input" type="number" min="0" step="0.01" value={line.price} onChange={(event) => change(line.id, 'price', event.target.value)} aria-label="Line unit price"/></td><td className="money">{formatMoney(Number(line.quantity || 0) * toMinor(line.price), settings.currencyCode)}</td><td><button type="button" className="button button-secondary" disabled={lines.length === 1} onClick={() => setLines((items) => items.filter((item) => item.id !== line.id))}>Remove</button></td></tr>)}</tbody></table></div><div className="summary-list"><div><span>Draft total</span><strong>{formatMoney(total, settings.currencyCode)}</strong></div></div></div>{message && <p className="notice" role="alert">{message}</p>}<div className="toolbar"><button className="button button-primary">Save draft</button></div></form></section>;
}
