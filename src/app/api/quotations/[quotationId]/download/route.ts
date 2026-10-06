import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(_: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return new Response('Sign in to download quotations.', { status: 401 });
  try {
    const quotation = getTenantStore().getQuotation(session, (await params).quotationId);
    if (!quotation) return new Response('Quotation not found.', { status: 404 });
    const rows = quotation.lines.map((line) => `<tr><td>${escapeHtml(line.serviceName)}</td><td>${line.frequency}</td><td>${line.quantity}</td><td>₹${(line.lineTotalMinor / 100).toFixed(2)}</td></tr>`).join('');
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(quotation.quoteNumber)}</title><style>body{font:14px Arial;color:#17232d;margin:40px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left}h1{margin-bottom:4px}</style></head><body><h1>Quotation ${escapeHtml(quotation.quoteNumber)}</h1><p>Prepared for ${escapeHtml(quotation.customerName)}${quotation.customerEmail ? ` (${escapeHtml(quotation.customerEmail)})` : ''}</p><table><thead><tr><th>Service</th><th>Frequency</th><th>Qty</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><h2>Total: ₹${(quotation.totalMinor / 100).toFixed(2)}</h2></body></html>`;
    return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${quotation.quoteNumber}.html"` } });
  } catch (error) { return new Response(error instanceof Error ? error.message : 'Quotation could not be downloaded.', { status: 403 }); }
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character); }
