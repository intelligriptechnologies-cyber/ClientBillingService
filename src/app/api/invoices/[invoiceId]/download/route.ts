import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfResponse } from '@/lib/pdf-renderer';
import { renderInvoiceHtml } from '@/lib/invoice-html';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = getTenantStore().getInvoice(session, (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    return await pdfResponse(`${invoice.invoiceNumber}.pdf`, renderInvoiceHtml(invoice));
  } catch (cause) { recordOperationException(session, '/api/invoices/[invoiceId]/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download invoice.', { status: 403 }); }
}
