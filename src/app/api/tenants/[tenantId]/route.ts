import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantStatus } from '@/lib/tenant-store';

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
  try {
    const { tenantId } = await context.params;
    const body = await request.json() as { name?: string; status?: TenantStatus };
    return NextResponse.json({ tenant: getTenantStore().updateTenant(session, tenantId, body) });
  } catch (error) { recordOperationException(session, '/api/tenants/[tenantId]', error);
    const message = error instanceof Error ? error.message : 'Unable to update tenant.';
    return NextResponse.json({ message }, { status: message.includes('superadmin') ? 403 : 400 });
  }
}
