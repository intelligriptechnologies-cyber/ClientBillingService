import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type InvoiceInput, type InvoiceQuery } from '@/lib/tenant-store';

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
  try { return NextResponse.json(await getTenantStore().listInvoices(session, query)); }
  catch (cause) { await recordOperationException(session, '/api/invoices', cause); return error(cause instanceof Error ? cause.message : 'Unable to load invoices.', 400); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return error('A tenant session is required.', 401);
  try { return NextResponse.json({ invoice: await getTenantStore().createIssuedInvoice(session, await request.json() as InvoiceInput) }, { status: 201 }); }
  catch (cause) { await recordOperationException(session, '/api/invoices', cause); return error(cause instanceof Error ? cause.message : 'Unable to create invoice.', 400); }
}
