import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type CustomerInput, type CustomerStatus } from '@/lib/tenant-store';

async function tenantSession() { return getCurrentSession(); }
export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const session = await tenantSession(); if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const { customerId } = await params;
  try {
    const body = await request.json() as CustomerInput & { status?: CustomerStatus };
    const store = getTenantStore();
    const customer = body.status ? await store.setCustomerStatus(session, customerId, body.status) : await store.updateCustomer(session, customerId, body);
    return NextResponse.json(customer);
  } catch (error) { await recordOperationException(session, '/api/customers/[customerId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update customer.' }, { status: 400 }); }
}
