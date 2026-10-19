import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { recordOperationException } from '@/lib/operational-error';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request); if (principal?.kind !== 'member') return new Response('A tenant session is required.', { status: 401 });
  try {
  const params = new URL(request.url).searchParams;
  const query = { customerId: params.get('customerId') || undefined, search: params.get('search') || undefined, month: params.get('month') || undefined, pageSize: 100 };
  const first = await getTenantStore().listPayments(tenantContextOf(principal), { ...query, page: 1 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page++) items.push(...(await getTenantStore().listPayments(tenantContextOf(principal), { ...query, page })).items);
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = ['Payment date,Invoice,Customer,Payment,TDS,Write-off,Applied,Method,Reference,Notes', ...items.map((item) => [item.paymentDate, item.invoiceNumber, item.customerName, item.amountMinor / 100, item.tdsMinor / 100, item.writeOffMinor / 100, item.appliedMinor / 100, item.method, item.reference, item.notes].map(quote).join(','))].join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payment-register.csv"' } });
  } catch (error) { await recordOperationException(principal, '/api/payments/download', error); return new Response('Unable to download payments.', { status: 400 }); }
}
