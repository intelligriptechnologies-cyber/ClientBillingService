import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type PaymentMethod } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function error(message: string, status: number) { return NextResponse.json({ message }, { status }); }
export async function GET(request: Request) {
  const principal = await getPrincipal(request); if (principal?.kind !== 'member') return error('A tenant session is required.', 401);
  const params = new URL(request.url).searchParams;
  try { return NextResponse.json(await getTenantStore().listPayments(tenantContextOf(principal), { customerId: params.get('customerId') || undefined, search: params.get('search') || undefined, month: params.get('month') || undefined, page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 20) })); }
  catch (cause) { await recordOperationException(principal, '/api/payments', cause); return error(cause instanceof Error ? cause.message : 'Unable to load payments.', 400); }
}
export async function POST(request: Request) {
  const principal = await getPrincipal(request); if (principal?.kind !== 'member') return error('A tenant session is required.', 401);
  try {
    const body = await request.json();
    return NextResponse.json(await getTenantStore().recordPayment(tenantContextOf(principal), { invoiceId: String(body.invoiceId ?? ''), paymentDate: String(body.paymentDate ?? ''), amountMinor: Number(body.amountMinor), tdsMinor: Number(body.tdsMinor), writeOffMinor: Number(body.writeOffMinor), method: body.method as PaymentMethod, reference: String(body.reference ?? ''), notes: String(body.notes ?? '') }), { status: 201 });
  } catch (cause) { await recordOperationException(principal, '/api/payments', cause); return error(cause instanceof Error ? cause.message : 'Unable to record payment.', 400); }
}
