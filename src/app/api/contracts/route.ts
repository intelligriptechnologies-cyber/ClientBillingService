import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type ContractInput, type ContractQuery } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  const params = new URL(request.url).searchParams;
  const status = params.get('status');
  const query: ContractQuery = { search: params.get('search') ?? undefined, month: params.get('month') ?? undefined, customerId: params.get('customerId') ?? undefined, status: status === 'active' || status === 'inactive' ? status : undefined, page: Number(params.get('page') ?? 1), pageSize: Number(params.get('pageSize') ?? 10) };
  try { return NextResponse.json(await getTenantStore().listContracts(tenantContextOf(session), query)); }
  catch (error) { await recordOperationException(session, '/api/contracts', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load contracts.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try { return NextResponse.json(await getTenantStore().createContract(tenantContextOf(session), await request.json() as ContractInput), { status: 201 }); }
  catch (error) { await recordOperationException(session, '/api/contracts', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to create contract.' }, { status: 400 }); }
}
