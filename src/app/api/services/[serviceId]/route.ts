import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type ServiceUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

export async function PATCH(request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage services.' }, { status: 401 });
  try {
    const { serviceId } = await params;
    return NextResponse.json({ service: await getTenantStore().updateService(tenantContextOf(session), serviceId, await request.json() as ServiceUpdate) });
  } catch (error) { await recordOperationException(session, '/api/services/[serviceId]', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Service could not be updated.' }, { status: 400 }); }
}
