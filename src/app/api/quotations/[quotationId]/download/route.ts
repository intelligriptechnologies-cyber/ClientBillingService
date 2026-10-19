import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfDownload } from '@/lib/pdf';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(_: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  const principal = await getPrincipal(_);
  if (!principal) return new Response('Sign in to download quotations.', { status: 401 });
  try {
    const quotation = await getTenantStore().getQuotation(tenantContextOf(principal), (await params).quotationId);
    const settings = await getTenantStore().getTenantSettings(tenantContextOf(principal));
    return pdfDownload(`${quotation.quoteNumber}.pdf`, `QUOTATION ${quotation.quoteNumber}`, [`Prepared for: ${quotation.customerName}`, quotation.customerEmail ?? '', '', ...quotation.lines.map((line) => `${line.serviceName} | ${line.frequency} | Qty ${line.quantity} | INR ${(line.lineTotalMinor / 100).toFixed(2)}`), '', `Total: INR ${(quotation.totalMinor / 100).toFixed(2)}`], settings);
  } catch (error) { await recordOperationException(principal, '/api/quotations/[quotationId]/download', error); return new Response(error instanceof Error ? error.message : 'Quotation could not be downloaded.', { status: 403 }); }
}
