import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from "@/lib/auth/session-context";

/** Lets the invoice editor preselect the tax split. A bad GSTIN is feedback while typing, so it is not logged as an operational error. */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json({ supply: await getTenantStore().getSupplyContext(tenantContextOf(session), { customerId: params.get('customerId') ?? undefined, customerGstin: params.get('customerGstin') ?? undefined, billingStateCode: params.get('billingStateCode') ?? undefined }) });
  } catch (cause) {
    return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to work out the place of supply.' }, { status: 400 });
  }
}
