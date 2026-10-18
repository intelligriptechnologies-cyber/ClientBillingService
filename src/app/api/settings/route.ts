import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantSettingsInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

function responseError(error: unknown) {
  return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to manage tenant settings.' }, { status: 403 });
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to view settings.' }, { status: 401 });
  try { return NextResponse.json({ settings: await getTenantStore().getTenantSettings(tenantContextOf(session)) }); }
  catch (error) { await recordOperationException(session, '/api/settings', error); return responseError(error); }
}

export async function PUT(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage settings.' }, { status: 401 });
  try { return NextResponse.json({ settings: await getTenantStore().updateTenantSettings(tenantContextOf(session), await request.json() as TenantSettingsInput) }); }
  catch (error) { await recordOperationException(session, '/api/settings', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to save settings.' }, { status: 400 }); }
}
