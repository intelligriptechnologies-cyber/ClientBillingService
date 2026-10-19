import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type ContractUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().updateContract(tenantContextOf(principal), (await params).contractId, await request.json() as ContractUpdate)); }
  catch (error) { await recordOperationException(principal, '/api/contracts/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update contract.' }, { status: 400 }); }
}
