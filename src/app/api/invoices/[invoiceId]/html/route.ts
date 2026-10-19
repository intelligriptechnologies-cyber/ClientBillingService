import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { renderInvoiceHtml } from '@/lib/invoice-html';
import { tenantContextOf } from '@/lib/auth/principal';

/** The markup the PDF is printed from, shown as the on-screen preview. */
export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = await getTenantStore().getInvoice(tenantContextOf(principal), (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    return new Response(renderInvoiceHtml(invoice), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" } });
  } catch (cause) { await recordOperationException(principal, '/api/invoices/[invoiceId]/html', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to preview invoice.', { status: 403 }); }
}
