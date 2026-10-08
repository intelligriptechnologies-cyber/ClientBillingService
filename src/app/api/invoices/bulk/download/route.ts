import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfDownload } from '@/lib/pdf';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  const billingPeriod = new URL(request.url).searchParams.get('period') ?? '';
  try {
    const preview = getTenantStore().previewBulkInvoices(session, billingPeriod);
    return pdfDownload(`bulk-invoice-preview-${billingPeriod}.pdf`, `BULK INVOICE PREVIEW ${billingPeriod}`, [...preview.proposed.map((item) => `Proposed | ${item.customerName} | ${item.contractName} | Total INR ${(item.totalMinor / 100).toFixed(2)}`), ...preview.skipped.map((item) => `Skipped | ${item.customerName} | ${item.contractName} | ${item.reason}`)], getTenantStore().getTenantSettings(session));
  } catch (cause) { recordOperationException(session, '/api/invoices/bulk/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download preview.', { status: 400 }); }
}
