import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unable to manage tenants.';
  return NextResponse.json({ message }, { status: message.includes('superadmin') ? 403 : 400 });
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  try {
    const requestedStatus = searchParams.get('status');
    return NextResponse.json(getTenantStore().listTenants(session, {
      query: searchParams.get('query') ?? undefined,
      month: searchParams.get('month') ?? undefined,
      status: requestedStatus === 'active' || requestedStatus === 'disabled' ? requestedStatus : 'all',
      page: Number(searchParams.get('page')) || 1,
      pageSize: Number(searchParams.get('pageSize')) || 10,
    }));
  } catch (error) { recordOperationException(session, '/api/tenants', error); return failure(error); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
  try {
    const body = await request.json() as { name?: string };
    return NextResponse.json({ tenant: getTenantStore().createTenant(session, { name: body.name ?? '' }) }, { status: 201 });
  } catch (error) { recordOperationException(session, '/api/tenants', error); return failure(error); }
}
