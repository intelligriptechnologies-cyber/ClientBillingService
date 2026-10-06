'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageTitle, Status } from '@/components/ui';
import type { TenantInvoice } from '@/lib/tenant-store';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>(); const [invoice, setInvoice] = useState<TenantInvoice | null>(null); const [message, setMessage] = useState('');
  useEffect(() => { void fetch(`/api/invoices/${invoiceId}`).then(async (response) => { const body = await response.json(); if (!response.ok) setMessage(body.message ?? 'Unable to load invoice.'); else setInvoice(body.invoice); }); }, [invoiceId]);
  if (!invoice) return <section className="page"><PageTitle eyebrow="Invoices" title="Invoice detail"/><p className="notice" role="status">{message || 'Loading invoice…'}</p></section>;
  const snapshot = invoice.snapshot;
  return <section className="page"><PageTitle eyebrow="Invoice detail" title={invoice.invoiceNumber}><div className="toolbar"><a className="button button-primary" href={`/api/invoices/${invoice.id}/download`}>Download invoice</a><Link className="button button-secondary" href="/invoices">Back to register</Link></div></PageTitle>
    <div className="detail-grid"><div className="stack"><div className="panel"><div className="panel-head"><h2>Billing snapshot</h2><Status status={invoice.status}/></div><div className="summary-list"><div><span>Issuer</span><strong>{snapshot.companyName}</strong></div><div><span>GSTIN</span><strong>{snapshot.gstin || 'Not configured'}</strong></div><div><span>Bill to</span><strong>{snapshot.customerName}</strong></div><div><span>Customer email</span><strong>{snapshot.customerEmail}</strong></div><div><span>Customer address</span><strong>{snapshot.customerAddress}</strong></div></div></div><div className="panel"><div className="panel-head"><h2>Tax summary</h2></div><div className="table-wrap"><table className="data-table"><tbody><tr><td>Taxable value</td><td className="money">{money(invoice.taxableMinor)}</td></tr><tr><td>GST ({invoice.gstRate}%)</td><td className="money">{money(invoice.gstMinor)}</td></tr><tr><th>Total</th><th className="money">{money(invoice.totalMinor)}</th></tr><tr><td>Paid</td><td className="money">{money(invoice.paidMinor)}</td></tr><tr><td>Outstanding</td><td className="money">{money(invoice.totalMinor - invoice.paidMinor)}</td></tr></tbody></table></div></div></div><aside className="panel"><div className="panel-head"><h2>Invoice record</h2></div><div className="summary-list"><div><span>Issue date</span><strong>{invoice.invoiceDate}</strong></div><div><span>Due date</span><strong>{invoice.dueDate}</strong></div><div><span>Issued at</span><strong>{new Date(invoice.issuedAt).toLocaleString()}</strong></div><div><span>Snapshot policy</span><strong>Commercial and branding details are preserved at issue.</strong></div></div></aside></div></section>;
}
