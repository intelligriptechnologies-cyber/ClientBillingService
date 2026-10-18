import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfDownload } from '@/lib/pdf';

export async function GET(_: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return new Response('Sign in to download quotations.', { status: 401 });
  try {
    const quotation = await getTenantStore().getQuotation(session, (await params).quotationId);
    if (!quotation) return new Response('Quotation not found.', { status: 404 });
    const settings = await getTenantStore().getTenantSettings(session);
    return pdfDownload(`${quotation.quoteNumber}.pdf`, `QUOTATION ${quotation.quoteNumber}`, [`Prepared for: ${quotation.customerName}`, quotation.customerEmail ?? '', '', ...quotation.lines.map((line) => `${line.serviceName} | ${line.frequency} | Qty ${line.quantity} | INR ${(line.lineTotalMinor / 100).toFixed(2)}`), '', `Total: INR ${(quotation.totalMinor / 100).toFixed(2)}`], settings);
  } catch (error) { await recordOperationException(session, '/api/quotations/[quotationId]/download', error); return new Response(error instanceof Error ? error.message : 'Quotation could not be downloaded.', { status: 403 }); }
}
