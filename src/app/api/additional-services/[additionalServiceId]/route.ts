import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type AdditionalServiceUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ additionalServiceId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json(await getTenantStore().updateAdditionalService(tenantContextOf(principal), (await params).additionalServiceId, await request.json() as AdditionalServiceUpdate)); }
  catch (error) { await recordOperationException(principal, '/api/additional-services/[additionalServiceId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to update additional service.' }, { status: 400 }); }
}
