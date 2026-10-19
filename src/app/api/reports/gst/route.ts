import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { gstSalesCsv, hsnSummaryCsv } from '@/lib/gst-sales-export';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfDownload } from '@/lib/pdf';
import { tenantContextOf } from '@/lib/auth/principal';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  const search = new URL(request.url).searchParams;
  const month = search.get('month') || currentMonth();
  const format = search.get('format');
  try {
    const report = await getTenantStore().getGstSalesReport(tenantContextOf(principal), month);
    if (format === 'csv') return new Response(gstSalesCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gst-sales-${month}.csv"` } });
    if (format === 'hsn-csv') return new Response(hsnSummaryCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gstr1-hsn-summary-${month}.csv"` } });
    if (format === 'pdf') return pdfDownload(`gst-sales-${month}.pdf`, `GST SALES ${month}`, [report.companyName, `GSTIN: ${report.gstin || 'Not configured'}`, '', ...report.items.map((item) => `${item.invoiceNumber} | ${item.customerName} | Taxable INR ${(item.taxableMinor / 100).toFixed(2)} | GST INR ${(item.gstMinor / 100).toFixed(2)} | Total INR ${(item.totalMinor / 100).toFixed(2)}`), '', `Taxable total: INR ${(report.totals.taxableMinor / 100).toFixed(2)}`, `GST total: INR ${(report.totals.gstMinor / 100).toFixed(2)}`, `Invoice total: INR ${(report.totals.totalMinor / 100).toFixed(2)}`], await getTenantStore().getTenantSettings(tenantContextOf(principal)));
    return Response.json(report);
  } catch (cause) { await recordOperationException(principal, '/api/reports/gst', cause);
    return Response.json({ message: cause instanceof Error ? cause.message : 'Unable to prepare GST sales report.' }, { status: 400 });
  }
}
