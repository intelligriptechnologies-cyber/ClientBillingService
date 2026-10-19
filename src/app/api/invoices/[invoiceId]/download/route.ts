import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfResponse } from '@/lib/pdf-renderer';
import { renderInvoiceHtml } from '@/lib/invoice-html';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = await getTenantStore().getInvoice(tenantContextOf(principal), (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    return await pdfResponse(`${invoice.invoiceNumber}.pdf`, renderInvoiceHtml(invoice));
  } catch (cause) { await recordOperationException(principal, '/api/invoices/[invoiceId]/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download invoice.', { status: 403 }); }
}
