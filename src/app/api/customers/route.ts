import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type CustomerInput, type CustomerQuery } from '@/lib/tenant-store';

function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  const params = new URL(request.url).searchParams;
  const query: CustomerQuery = {
    search: params.get('search') ?? undefined,
    status: params.get('status') === 'active' || params.get('status') === 'inactive' ? params.get('status') : undefined,
    invoiceDelivery: ['monthly', 'quarterly', 'email', 'manual'].includes(params.get('invoiceDelivery') ?? '') ? params.get('invoiceDelivery') as CustomerQuery['invoiceDelivery'] : undefined,
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
