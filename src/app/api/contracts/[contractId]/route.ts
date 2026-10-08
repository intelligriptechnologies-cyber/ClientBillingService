import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type ContractUpdate } from '@/lib/tenant-store';

export async function PATCH(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(getTenantStore().updateContract(session, (await params).contractId, await request.json() as ContractUpdate)); }
  catch (error) { recordOperationException(session, '/api/contracts/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update contract.' }, { status: 400 }); }
}
