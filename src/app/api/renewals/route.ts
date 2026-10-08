import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type RenewalQuery } from '@/lib/tenant-store';

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const query: RenewalQuery = { search: params.get('search') ?? undefined, month: params.get('month') ?? undefined, status: status === 'expired' || status === 'upcoming' || status === 'current' ? status : undefined, page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10) };
  try { return NextResponse.json(getTenantStore().listRenewals(session, query)); }
  catch (error) { recordOperationException(session, '/api/renewals', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load renewals.' }, { status: 400 }); }
}
