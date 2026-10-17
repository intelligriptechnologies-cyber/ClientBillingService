import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfResponse } from '@/lib/pdf-renderer';
import { renderBulkPreviewHtml } from '@/lib/bulk-preview-html';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  const billingPeriod = new URL(request.url).searchParams.get('period') ?? '';
  try {
    const store = getTenantStore();
    const html = renderBulkPreviewHtml(store.previewBulkInvoices(session, billingPeriod), store.getTenantSettings(session));
    return await pdfResponse(`bulk-invoice-preview-${billingPeriod}.pdf`, html);
  } catch (cause) { recordOperationException(session, '/api/invoices/bulk/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download preview.', { status: 400 }); }
}
