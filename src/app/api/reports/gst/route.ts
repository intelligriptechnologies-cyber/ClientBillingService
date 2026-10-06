import { getCurrentSession } from '@/lib/session';
import { gstSalesCsv, gstSalesPrintDocument } from '@/lib/gst-sales-export';
import { getTenantStore } from '@/lib/tenant-store';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  const search = new URL(request.url).searchParams;
  const month = search.get('month') || currentMonth();
  const format = search.get('format');
  try {
    const report = getTenantStore().getGstSalesReport(session, month);
    if (format === 'csv') return new Response(gstSalesCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gst-sales-${month}.csv"` } });
    if (format === 'print') return new Response(gstSalesPrintDocument(report), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="gst-sales-${month}.html"` } });
    return Response.json(report);
  } catch (cause) {
    return Response.json({ message: cause instanceof Error ? cause.message : 'Unable to prepare GST sales report.' }, { status: 400 });
  }
}
