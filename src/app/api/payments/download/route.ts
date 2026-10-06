import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(request: Request) {
  const session = await getCurrentSession(); if (!session?.tenantId) return new Response('A tenant session is required.', { status: 401 });
  const params = new URL(request.url).searchParams; const payments = getTenantStore().listPayments(session, { customerId: params.get('customerId') || undefined, month: params.get('month') || undefined, pageSize: 100 });
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = ['Payment date,Invoice,Customer,Payment,TDS,Write-off,Applied,Method,Reference,Notes', ...payments.items.map((item) => [item.paymentDate, item.invoiceNumber, item.customerName, item.amountMinor / 100, item.tdsMinor / 100, item.writeOffMinor / 100, item.appliedMinor / 100, item.method, item.reference, item.notes].map(quote).join(','))].join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payment-register.csv"' } });
}
