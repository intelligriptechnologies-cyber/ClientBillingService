import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type InvoiceQuery } from '@/lib/tenant-store';

function error(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return error('A tenant session is required.', 401);
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const query: InvoiceQuery = {
    search: params.get('search') ?? undefined,
    month: params.get('month') ?? undefined,
    status: status && ['issued', 'paid', 'partial', 'overdue', 'void'].includes(status) ? status as InvoiceQuery['status'] : undefined,
    page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10),
  };
  try { return NextResponse.json(getTenantStore().listInvoices(session, query)); }
  catch (cause) { return error(cause instanceof Error ? cause.message : 'Unable to load invoices.', 400); }
}
