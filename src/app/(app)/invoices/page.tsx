'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageTitle, Status } from '@/components/ui';
import type { InvoiceList, InvoiceStatus } from '@/lib/tenant-store';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
const statuses: InvoiceStatus[] = ['issued', 'partial', 'paid', 'overdue', 'void'];

export default function InvoicesPage() {
  const [data, setData] = useState<InvoiceList>({ items: [], total: 0 });
  const [search, setSearch] = useState(''); const [month, setMonth] = useState(''); const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [page, setPage] = useState(1); const pageSize = 10; const [error, setError] = useState('');
  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); if (search) params.set('search', search); if (month) params.set('month', month); if (status) params.set('status', status);
    const response = await fetch(`/api/invoices?${params}`); const body = await response.json(); if (!response.ok) { setError(body.message ?? 'Unable to load invoices.'); return; } setData(body); setError('');
  }, [month, page, search, status]);
  // This effect synchronizes the register with the route-handler query whenever a filter changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  function reset() { setSearch(''); setMonth(''); setStatus(''); setPage(1); }
  return <section className="page"><PageTitle eyebrow="Billing workspace" title="Invoices"><span className="subtle">Issued billing records</span><Link className="button button-primary" href="/invoices/bulk">Bulk invoice run</Link></PageTitle>
    <div className="toolbar"><input className="input filter-input" aria-label="Search invoices" placeholder="Invoice number or customer" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/><input className="input" aria-label="Invoice month" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }}/><select className="select" aria-label="Filter by invoice status" value={status} onChange={(event) => { setStatus(event.target.value as '' | InvoiceStatus); setPage(1); }}><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="button button-secondary" type="button" onClick={reset}>Clear filters</button></div>
    {error && <p className="notice" role="alert">{error}</p>}<div className="panel"><div className="panel-head"><h2>Invoice register</h2><span className="subtle">{data.total} invoice{data.total === 1 ? '' : 's'}</span></div>
      {data.items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Issue date</th><th>Due</th><th className="money">Taxable</th><th className="money">GST</th><th className="money">Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.items.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong></td><td>{invoice.customerName}</td><td>{invoice.invoiceDate}</td><td>{invoice.dueDate}</td><td className="money">{money(invoice.taxableMinor)}</td><td className="money">{money(invoice.gstMinor)}</td><td className="money">{money(invoice.totalMinor)}</td><td><Status status={invoice.status}/></td><td><Link className="button button-secondary" href={`/invoices/${invoice.id}`}>View</Link></td></tr>)}</tbody></table></div> : <div className="empty">No invoices match these filters.</div>}
      <div className="toolbar" style={{ padding: '16px' }}><span className="subtle">Page {page} of {pages}</span><button className="button button-secondary" type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><button className="button button-secondary" type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</button></div>
    </div></section>;
}
