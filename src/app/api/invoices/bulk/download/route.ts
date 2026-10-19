import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfResponse } from '@/lib/pdf-renderer';
import { renderBulkPreviewHtml } from '@/lib/bulk-preview-html';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return new Response('A tenant session is required.', { status: 401 });
  const billingPeriod = new URL(request.url).searchParams.get('period') ?? '';
  try {
    const store = getTenantStore();
    const html = renderBulkPreviewHtml(await store.previewBulkInvoices(tenantContextOf(principal), billingPeriod), await store.getTenantSettings(tenantContextOf(principal)));
    return await pdfResponse(`bulk-invoice-preview-${billingPeriod}.pdf`, html);
  } catch (cause) { await recordOperationException(principal, '/api/invoices/bulk/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download preview.', { status: 400 }); }
}
