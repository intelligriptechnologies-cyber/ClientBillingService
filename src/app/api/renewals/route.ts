import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type RenewalQuery } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const query: RenewalQuery = { search: params.get('search') ?? undefined, month: params.get('month') ?? undefined, status: status === 'expired' || status === 'upcoming' || status === 'current' ? status : undefined, page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10) };
  try { return NextResponse.json(await getTenantStore().listRenewals(tenantContextOf(principal), query)); }
  catch (error) { await recordOperationException(principal, '/api/renewals', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load renewals.' }, { status: 400 }); }
}
