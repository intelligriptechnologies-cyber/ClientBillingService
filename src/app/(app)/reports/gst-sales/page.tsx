'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/ui';
import { reportClientException } from '@/lib/client-error';
import { TablePager } from '@/components/table-pager';
import type { GstSalesReport } from '@/lib/tenant-store';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const monthOptions = Array.from({ length: 85 }, (_, index) => {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + 12 - index);
  return { value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
});

export default function GstSalesPage() {
  const [month, setMonth] = useState(currentMonth); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [report, setReport] = useState<GstSalesReport | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/reports/gst?month=${encodeURIComponent(month)}`); const body = await response.json();
      if (!response.ok) { setError(body.message ?? 'Unable to load GST sales report.'); setReport(null); return; }
      setReport(body as GstSalesReport); setError('');
    } catch (cause) { reportClientException('Load GST sales report', cause); setError('Unable to load GST sales report.'); setReport(null); }
  }, [month]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const exportUrl = (format: 'csv' | 'pdf') => `/api/reports/gst?month=${encodeURIComponent(month)}&format=${format}`;
  const rows = report?.items.filter((item) => `${item.invoiceNumber} ${item.invoiceDate} ${item.customerName} ${item.customerGstin}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageControl = <TablePager total={rows.length} page={currentPage} pageSize={pageSize} noun="invoices" onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />;
  return <section className="page"><PageTitle eyebrow="Finance intelligence" title="GST Sales"><span className="subtle">Invoice tax register for a selected billing month.</span></PageTitle>
    <div className="toolbar"><input className="input filter-input" aria-label="Search GST invoices" placeholder="Search invoice, customer, GSTIN" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select className="select compact-select" aria-label="GST report month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }}>{monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="button button-secondary" type="button" onClick={() => { setMonth(currentMonth()); setSearch(''); setPage(1); }}>Clear filters</button><a className="button button-secondary" href={exportUrl('csv')}>Download spreadsheet</a><a className="button button-secondary" href={exportUrl('pdf')}>Download PDF report</a></div>
    {error && <p className="notice" role="alert">{error}</p>}
    {report && <><div className="metric-grid"><article className="metric"><p>Taxable value</p><strong>{money(report.totals.taxableMinor)}</strong><small>{report.items.length} invoice{report.items.length === 1 ? '' : 's'} · {report.companyName}</small></article><article className="metric"><p>GST</p><strong>{money(report.totals.gstMinor)}</strong><small>Net GST {money(report.totals.netGstMinor)}</small></article><article className="metric"><p>Invoice total</p><strong>{money(report.totals.totalMinor)}</strong><small>GSTIN {report.gstin || 'Not configured'}</small></article></div><div className="panel"><div className="panel-head"><h2>GST invoice register</h2><span className="subtle">{report.month} · Report totals include all invoices in the month</span></div>{pageControl}<div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer / GSTIN</th><th className="money">Taxable</th><th className="money">GST</th><th className="money">Total</th><th className="money">IGST</th><th className="money">CGST</th><th className="money">SGST</th><th className="money">Net GST</th></tr></thead><tbody>{visible.map((item) => <tr key={item.invoiceId}><td><strong>{item.invoiceNumber}</strong><br /><span className="subtle">{item.invoiceDate}</span></td><td>{item.customerName}<br /><span className="subtle">{item.customerGstin || 'GSTIN not provided'}</span></td><td className="money">{money(item.taxableMinor)}</td><td className="money">{money(item.gstMinor)}</td><td className="money">{money(item.totalMinor)}</td><td className="money">{money(item.igstMinor)}</td><td className="money">{money(item.cgstMinor)}</td><td className="money">{money(item.sgstMinor)}</td><td className="money">{money(item.netGstMinor)}</td></tr>)}</tbody></table></div>{!rows.length && <div className="empty">No invoices match these filters.</div>}{pageControl}</div></>}
  </section>;
}
