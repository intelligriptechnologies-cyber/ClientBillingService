import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { renderInvoiceHtml } from '@/lib/invoice-html';

/** The markup the PDF is printed from, shown as the on-screen preview. */
export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = getTenantStore().getInvoice(session, (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    return new Response(renderInvoiceHtml(invoice), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" } });
  } catch (cause) { recordOperationException(session, '/api/invoices/[invoiceId]/html', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to preview invoice.', { status: 403 }); }
}
