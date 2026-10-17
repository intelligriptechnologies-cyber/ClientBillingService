'use client';

import { apiFetch } from '@/lib/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PageTitle, Status } from '@/components/ui';
import { TablePager } from '@/components/table-pager';
import { MonthYearFilter } from '@/components/month-year-filter';
import { reportClientException } from '@/lib/client-error';
import { VoidDialog } from '@/components/void-dialog';
import { InvoiceEditorDialog } from '@/components/invoice-editor-dialog';
import { BulkInvoiceDialog } from '@/components/bulk-invoice-dialog';
import type { InvoiceList, InvoiceStatus, TenantInvoice } from '@/lib/tenant-store';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
const statuses: InvoiceStatus[] = ['issued', 'partial', 'paid', 'overdue', 'void'];

export function InvoiceRegister({ bulkOpen = false, onCloseBulk }: { bulkOpen?: boolean; onCloseBulk?: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<InvoiceList>({ items: [], total: 0 });
  const [search, setSearch] = useState(''); const [month, setMonth] = useState(''); const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10); const [error, setError] = useState(''); const [voidId, setVoidId] = useState<string | null>(null); const [editor, setEditor] = useState<TenantInvoice | 'create' | null>(null);
  async function voidInvoice(reason: string) { if (!voidId) return; try { const response = await apiFetch(`/api/invoices/${voidId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'void', reason }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Unable to void invoice.'); setVoidId(null); await load(); } catch (cause) { reportClientException('Void invoice', cause); setError(cause instanceof Error ? cause.message : 'Unable to void invoice.'); } }
  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) }); if (search) params.set('search', search); if (month) params.set('month', month); if (status) params.set('status', status);
    const response = await apiFetch(`/api/invoices?${params}`); const body = await response.json(); if (!response.ok) { setError(body.message ?? 'Unable to load invoices.'); return; } setData(body); setError('');
  }, [month, page, pageSize, search, status]);
  // This effect synchronizes the register with the route-handler query whenever a filter changes.
  useEffect(() => { void load(); }, [load]);
  function reset() { setSearch(''); setMonth(''); setStatus(''); setPage(1); }
  return <section className="page"><PageTitle eyebrow="Billing workspace" title="Invoices"><span className="subtle">Issued billing records</span><button className="button button-primary" type="button" onClick={() => setEditor('create')}>Add invoice</button><button className="button button-secondary" type="button" onClick={() => router.push('/invoices/bulk')}>Bulk invoice run</button></PageTitle>
    <div className="toolbar"><input className="input filter-input" aria-label="Search invoices" placeholder="Invoice number or customer" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/><MonthYearFilter label="Invoice month" value={month} onChange={(value) => { setMonth(value); setPage(1); }}/><select className="select" aria-label="Filter by invoice status" value={status} onChange={(event) => { setStatus(event.target.value as '' | InvoiceStatus); setPage(1); }}><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="button button-secondary" type="button" onClick={reset}>Clear filters</button></div>
    {error && <p className="notice" role="alert">{error}</p>}<div className="panel"><div className="panel-head"><h2>Invoice register</h2><span className="subtle">{data.total} invoice{data.total === 1 ? '' : 's'}</span></div>
      <TablePager total={data.total} page={page} pageSize={pageSize} noun="invoices" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      {data.items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Issue date</th><th>Due</th><th className="money">Taxable</th><th className="money">GST</th><th className="money">Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.items.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong></td><td>{invoice.customerName}</td><td>{invoice.invoiceDate}</td><td>{invoice.dueDate}</td><td className="money">{money(invoice.taxableMinor)}</td><td className="money">{money(invoice.gstMinor)}</td><td className="money">{money(invoice.totalMinor)}</td><td><Status status={invoice.status}/></td><td><div className="row-actions"><Link className="link-button" href={`/invoices/${invoice.id}`}>View</Link>{invoice.status !== 'void' && invoice.paidMinor === 0 && <><button className="link-button" type="button" onClick={() => setEditor(invoice)}>Correct</button><button className="link-button link-danger" type="button" onClick={() => setVoidId(invoice.id)}>Void</button></>}</div></td></tr>)}</tbody></table></div> : <div className="empty">No invoices match these filters.</div>}
      <TablePager total={data.total} page={page} pageSize={pageSize} noun="invoices" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
    </div>{editor && <InvoiceEditorDialog key={editor === 'create' ? 'create' : editor.id} invoice={editor === 'create' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { void load(); }} />}<VoidDialog open={!!voidId} onCancel={() => setVoidId(null)} onConfirm={(reason) => void voidInvoice(reason)} />{bulkOpen && <BulkInvoiceDialog onClose={onCloseBulk ?? (() => {})} onIssued={() => { void load(); }} />}</section>;
}
