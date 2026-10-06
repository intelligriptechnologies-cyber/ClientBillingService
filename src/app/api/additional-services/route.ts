import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type AdditionalServiceInput, type AdditionalServiceQuery } from '@/lib/tenant-store';

function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  const params = new URL(request.url).searchParams; const status = params.get('status');
  const query: AdditionalServiceQuery = { search: params.get('search') ?? undefined, customerId: params.get('customerId') ?? undefined, contractId: params.get('contractId') ?? undefined, status: status === 'active' || status === 'archived' ? status : undefined, billingPeriod: params.get('billingPeriod') ?? undefined, page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10) };
  try { return NextResponse.json(getTenantStore().listAdditionalServices(session, query)); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load additional services.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try { return NextResponse.json(getTenantStore().createAdditionalService(session, await request.json() as AdditionalServiceInput), { status: 201 }); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create additional service.' }, { status: 400 }); }
}
