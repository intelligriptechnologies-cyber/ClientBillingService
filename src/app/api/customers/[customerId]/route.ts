import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type CustomerInput, type CustomerStatus } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const principal = await getPrincipal(request); if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const { customerId } = await params;
  try {
    const body = await request.json() as CustomerInput & { status?: CustomerStatus };
    const store = getTenantStore();
    const customer = body.status ? await store.setCustomerStatus(tenantContextOf(principal), customerId, body.status) : await store.updateCustomer(tenantContextOf(principal), customerId, body);
    return NextResponse.json(customer);
  } catch (error) { await recordOperationException(principal, '/api/customers/[customerId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update customer.' }, { status: 400 }); }
}
