import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  try {
    const invoice = getTenantStore().getInvoice(session, (await context.params).invoiceId);
    if (!invoice) return new Response('Invoice not found.', { status: 404 });
    const snapshot = invoice.snapshot;
    const document = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoice.invoiceNumber)}</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;color:#172033}header{display:flex;justify-content:space-between;border-bottom:2px solid #172033;padding-bottom:24px}table{width:100%;border-collapse:collapse;margin:28px 0}td{padding:10px;border-bottom:1px solid #ddd}.right{text-align:right}.total{font-size:20px;font-weight:700}</style></head><body><header><div><h1>${escape(snapshot.companyName)}</h1><p>${escape(snapshot.address)}<br>${escape(snapshot.gstin)}</p></div><div class="right"><h2>INVOICE</h2><strong>${escape(invoice.invoiceNumber)}</strong><p>Issued ${escape(invoice.invoiceDate)}<br>Due ${escape(invoice.dueDate)}</p></div></header><h3>Bill to</h3><p><strong>${escape(snapshot.customerName)}</strong><br>${escape(snapshot.customerAddress)}<br>${escape(snapshot.customerEmail)}</p><table><tr><td>Taxable value</td><td class="right">${money(invoice.taxableMinor)}</td></tr><tr><td>GST (${invoice.gstRate}%)</td><td class="right">${money(invoice.gstMinor)}</td></tr><tr class="total"><td>Total</td><td class="right">${money(invoice.totalMinor)}</td></tr></table><p>${escape(snapshot.footer)}</p></body></html>`;
    return new Response(document, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.html"` } });
  } catch (cause) { return new Response(cause instanceof Error ? cause.message : 'Unable to download invoice.', { status: 403 }); }
}
