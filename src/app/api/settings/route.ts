import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TenantSettingsInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function responseError(error: unknown) {
  return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to manage tenant settings.' }, { status: 403 });
}

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to view settings.' }, { status: 401 });
  try { return NextResponse.json({ settings: await getTenantStore().getTenantSettings(tenantContextOf(principal)) }); }
  catch (error) { await recordOperationException(principal, '/api/settings', error); return responseError(error); }
}

export async function PUT(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage settings.' }, { status: 401 });
  try { return NextResponse.json({ settings: await getTenantStore().updateTenantSettings(tenantContextOf(principal), await request.json() as TenantSettingsInput) }); }
  catch (error) { await recordOperationException(principal, '/api/settings', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to save settings.' }, { status: 400 }); }
}
