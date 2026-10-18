import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
  try {
    const { tenantId } = await context.params;
    return NextResponse.json({ events: await getTenantStore().listTenantHistory(session, tenantId) });
  } catch (error) { await recordOperationException(session, '/api/tenants/[tenantId]/history', error);
    const message = error instanceof Error ? error.message : 'Unable to load tenant history.';
    return NextResponse.json({ message }, { status: message.includes('superadmin') ? 403 : 400 });
  }
}
