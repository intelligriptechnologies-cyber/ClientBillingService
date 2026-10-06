import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantUserUpdate } from '@/lib/tenant-store';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  const { userId } = await context.params;
  try {
    const update = await request.json() as TenantUserUpdate;
    const user = getTenantStore().updateTenantUser(session, userId, update);
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update this user.';
    return NextResponse.json({ message }, { status: message.includes('admin') || message.includes('tenant') ? 403 : 400 });
  }
}
