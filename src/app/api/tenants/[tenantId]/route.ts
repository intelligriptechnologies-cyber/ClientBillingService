import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TenantStatus } from '@/lib/tenant-store';
import { platformActorOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
  try {
    const { tenantId } = await context.params;
    const body = await request.json() as { name?: string; status?: TenantStatus };
    return NextResponse.json({ tenant: await getTenantStore().updateTenant(platformActorOf(principal), tenantId, body) });
  } catch (error) { await recordOperationException(principal, '/api/tenants/[tenantId]', error);
    const message = error instanceof Error ? error.message : 'Unable to update tenant.';
    return NextResponse.json({ message }, { status: message.includes('superadmin') ? 403 : 400 });
  }
}
