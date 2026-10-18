import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type AdditionalServiceUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

export async function PATCH(request: Request, { params }: { params: Promise<{ additionalServiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().updateAdditionalService(tenantContextOf(session), (await params).additionalServiceId, await request.json() as AdditionalServiceUpdate)); }
  catch (error) { await recordOperationException(session, '/api/additional-services/[additionalServiceId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update additional service.' }, { status: 400 }); }
}
