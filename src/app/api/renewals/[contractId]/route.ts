import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(_request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const principal = await getPrincipal(_request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ audit: await getTenantStore().listContractAudit(tenantContextOf(principal), (await params).contractId) }); }
  catch (error) { await recordOperationException(principal, '/api/renewals/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load renewal audit.' }, { status: 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().renewContract(tenantContextOf(principal), (await params).contractId, await request.json() as { endDate: string; note: string })); }
  catch (error) { await recordOperationException(principal, '/api/renewals/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to renew contract.' }, { status: 400 }); }
}
