import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

const csv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  const billingPeriod = new URL(request.url).searchParams.get('period') ?? '';
  try {
    const preview = getTenantStore().previewBulkInvoices(session, billingPeriod);
    const rows = [
      ['Type', 'Customer', 'Contract', 'Reason / additional lines', 'Taxable', 'GST', 'Total'],
      ...preview.proposed.map((item) => ['Proposed', item.customerName, item.contractName, item.additionalLines.map((line) => line.description).join('; '), item.taxableMinor / 100, item.gstMinor / 100, item.totalMinor / 100]),
      ...preview.skipped.map((item) => ['Skipped', item.customerName, item.contractName, item.reason, '', '', '']),
    ].map((row) => row.map(csv).join(',')).join('\n');
    return new Response(rows, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bulk-invoice-preview-${billingPeriod}.csv"` } });
  } catch (cause) { return new Response(cause instanceof Error ? cause.message : 'Unable to download preview.', { status: 400 }); }
}
