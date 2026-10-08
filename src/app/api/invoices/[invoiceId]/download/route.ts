import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { pdfDownload } from '@/lib/pdf';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = getTenantStore().getInvoice(session, (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    const snapshot = invoice.snapshot;
    const lines = [snapshot.companyName, snapshot.address, `GSTIN: ${snapshot.gstin}`, '', `Bill to: ${snapshot.customerName}`, snapshot.customerAddress, snapshot.customerEmail, snapshot.customerPan ? `Customer PAN: ${snapshot.customerPan}` : '', snapshot.customerGstin ? `Customer GSTIN: ${snapshot.customerGstin}` : '', '', `Issued: ${invoice.invoiceDate}    Due: ${invoice.dueDate}`, snapshot.venue ? `Venue: ${snapshot.venue}` : '', '', ...snapshot.lines?.flatMap((line) => [`${line.description}  |  ${line.quantity} x ${money(line.rateMinor)}  |  ${line.taxType === 'none' ? 'No GST' : `${line.taxType === 'igst' ? 'IGST' : 'CGST + SGST'} ${line.gstRate}%`}  |  ${money(line.totalMinor)}`]) ?? [], '', `Taxable value: ${money(invoice.taxableMinor)}`, `GST: ${money(invoice.gstMinor)}`, `Total: ${money(invoice.totalMinor)}`, snapshot.notes ? `Notes: ${snapshot.notes}` : '', '', snapshot.footer];
    return pdfDownload(`${invoice.invoiceNumber}.pdf`, `INVOICE ${invoice.invoiceNumber}`, lines, snapshot);
  } catch (cause) { recordOperationException(session, '/api/invoices/[invoiceId]/download', cause); return new Response(cause instanceof Error ? cause.message : 'Unable to download invoice.', { status: 403 }); }
}
