'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/ui';
import type { GstSalesReport } from '@/lib/tenant-store';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
const defaultMonth = new Date().toISOString().slice(0, 7);

export default function GstSalesPage() {
  const [month, setMonth] = useState(defaultMonth); const [report, setReport] = useState<GstSalesReport | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/reports/gst?month=${encodeURIComponent(month)}`); const body = await response.json();
    if (!response.ok) { setError(body.message ?? 'Unable to load GST sales report.'); setReport(null); return; }
    setReport(body as GstSalesReport); setError('');
  }, [month]);
  // This effect reloads the public report seam whenever the selected period changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const exportUrl = (format: 'csv' | 'print') => `/api/reports/gst?month=${encodeURIComponent(month)}&format=${format}`;
  const totals = report?.totals;
  return <section className="page"><PageTitle eyebrow="Finance intelligence" title="GST Sales"><span className="subtle">Invoice tax register for a selected billing month.</span></PageTitle>
    <div className="toolbar"><label className="field">Report month<input className="input" aria-label="GST report month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="button button-secondary" type="button" onClick={() => setMonth(defaultMonth)}>Current month</button><a className="button button-secondary" href={exportUrl('csv')}>Download spreadsheet</a><a className="button button-secondary" href={exportUrl('print')}>Download print-ready report</a></div>
    {error && <p className="notice" role="alert">{error}</p>}
    {report && <><div className="metric-grid"><article className="metric"><p>Taxable value</p><strong>{money(totals!.taxableMinor)}</strong><small>{report.items.length} invoice{report.items.length === 1 ? '' : 's'} · {report.companyName}</small></article><article className="metric"><p>GST</p><strong>{money(totals!.gstMinor)}</strong><small>Net GST {money(totals!.netGstMinor)}</small></article><article className="metric"><p>Invoice total</p><strong>{money(totals!.totalMinor)}</strong><small>GSTIN {report.gstin || 'Not configured'}</small></article></div><div className="panel"><div className="panel-head"><h2>GST invoice register</h2><span className="subtle">{report.month}</span></div>{report.items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Invoice</th><th>Customer / GSTIN</th><th className="money">Taxable</th><th className="money">GST</th><th className="money">Total</th><th className="money">IGST</th><th className="money">CGST</th><th className="money">SGST</th><th className="money">Net GST</th></tr></thead><tbody>{report.items.map((item) => <tr key={item.invoiceId}><td><strong>{item.invoiceNumber}</strong><br /><span className="subtle">{item.invoiceDate}</span></td><td>{item.customerName}<br /><span className="subtle">{item.customerGstin || 'GSTIN not provided'}</span></td><td className="money">{money(item.taxableMinor)}</td><td className="money">{money(item.gstMinor)}</td><td className="money">{money(item.totalMinor)}</td><td className="money">{money(item.igstMinor)}</td><td className="money">{money(item.cgstMinor)}</td><td className="money">{money(item.sgstMinor)}</td><td className="money">{money(item.netGstMinor)}</td></tr>)}<tr><td colSpan={2}><strong>Total</strong></td><td className="money"><strong>{money(totals!.taxableMinor)}</strong></td><td className="money"><strong>{money(totals!.gstMinor)}</strong></td><td className="money"><strong>{money(totals!.totalMinor)}</strong></td><td className="money"><strong>{money(totals!.igstMinor)}</strong></td><td className="money"><strong>{money(totals!.cgstMinor)}</strong></td><td className="money"><strong>{money(totals!.sgstMinor)}</strong></td><td className="money"><strong>{money(totals!.netGstMinor)}</strong></td></tr></tbody></table></div> : <div className="empty">No non-void invoices were issued in this month.</div>}</div></>}
  </section>;
}
