import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TenantUserUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  const { userId } = await context.params;
  try {
    const update = await request.json() as TenantUserUpdate;
    const user = await getTenantStore().updateTenantUser(tenantContextOf(principal), userId, update);
    return NextResponse.json({ user });
  } catch (error) { await recordOperationException(principal, '/api/users/[userId]', error);
    const message = error instanceof Error ? error.message : 'Unable to update this user.';
    return NextResponse.json({ message }, { status: message.includes('at least one active admin') ? 409 : message.includes('admin') || message.includes('tenant') ? 403 : 400 });
  }
}
