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
    return pdfDownload(`${invoice.invoiceNumber}.pdf`, `INVOICE ${invoice.invoiceNumber}`, [snapshot.companyName, snapshot.address, `GSTIN: ${snapshot.gstin}`, '', `Bill to: ${snapshot.customerName}`, snapshot.customerAddress, snapshot.customerEmail, '', `Issued: ${invoice.invoiceDate}    Due: ${invoice.dueDate}`, `Taxable value: ${money(invoice.taxableMinor)}`, `GST (${invoice.gstRate}%): ${money(invoice.gstMinor)}`, `Total: ${money(invoice.totalMinor)}`, '', snapshot.footer], snapshot);
  } catch (cause) { return new Response(cause instanceof Error ? cause.message : 'Unable to download invoice.', { status: 403 }); }
}
