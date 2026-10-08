import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type CustomerInput, type CustomerQuery } from '@/lib/tenant-store';

function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try {
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const invoiceDelivery = params.get('invoiceDelivery');
  const query: CustomerQuery = {
    search: params.get('search') ?? undefined,
    month: params.get('month') ?? undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    invoiceDelivery: invoiceDelivery && ['monthly', 'quarterly', 'email', 'manual'].includes(invoiceDelivery) ? invoiceDelivery as Exclude<CustomerQuery['invoiceDelivery'], undefined> : undefined,
    page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10),
  };
  return NextResponse.json(getTenantStore().listCustomers(session, query));
  } catch (error) { recordOperationException(session, '/api/customers', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load customers.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try { return NextResponse.json(getTenantStore().createCustomer(session, await request.json() as CustomerInput), { status: 201 }); }
  catch (error) { recordOperationException(session, '/api/customers', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create customer.' }, { status: 400 }); }
}
