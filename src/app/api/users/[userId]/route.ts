import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantUserUpdate } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  const { userId } = await context.params;
  try {
    const update = await request.json() as TenantUserUpdate;
    const user = await getTenantStore().updateTenantUser(tenantContextOf(session), userId, update);
    return NextResponse.json({ user });
  } catch (error) { await recordOperationException(session, '/api/users/[userId]', error);
    const message = error instanceof Error ? error.message : 'Unable to update this user.';
    return NextResponse.json({ message }, { status: message.includes('at least one active admin') ? 409 : message.includes('admin') || message.includes('tenant') ? 403 : 400 });
  }
}
