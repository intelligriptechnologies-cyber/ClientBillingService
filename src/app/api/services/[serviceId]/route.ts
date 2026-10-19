import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type ServiceUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage services.' }, { status: 401 });
  try {
    const { serviceId } = await params;
    return NextResponse.json({ service: await getTenantStore().updateService(tenantContextOf(principal), serviceId, await request.json() as ServiceUpdate) });
  } catch (error) { await recordOperationException(principal, '/api/services/[serviceId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Service could not be updated.' }, { status: 400 }); }
}
