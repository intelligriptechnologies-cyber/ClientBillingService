import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type CustomerInput, type CustomerQuery } from '@/lib/tenant-store';

function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const invoiceDelivery = params.get('invoiceDelivery');
  const query: CustomerQuery = {
    search: params.get('search') ?? undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    invoiceDelivery: invoiceDelivery && ['monthly', 'quarterly', 'email', 'manual'].includes(invoiceDelivery) ? invoiceDelivery as Exclude<CustomerQuery['invoiceDelivery'], undefined> : undefined,
    page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10),
  };
  return NextResponse.json(getTenantStore().listCustomers(session, query));
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try { return NextResponse.json(getTenantStore().createCustomer(session, await request.json() as CustomerInput), { status: 201 }); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create customer.' }, { status: 400 }); }
}
