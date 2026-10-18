import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(_request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ audit: await getTenantStore().listContractAudit(session, (await params).contractId) }); }
  catch (error) { await recordOperationException(session, '/api/renewals/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load renewal audit.' }, { status: 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().renewContract(session, (await params).contractId, await request.json() as { endDate: string; note: string })); }
  catch (error) { await recordOperationException(session, '/api/renewals/[contractId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to renew contract.' }, { status: 400 }); }
}
