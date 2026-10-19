import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to preview templates.' }, { status: 401 });
  try { return NextResponse.json({ preview: await getTenantStore().previewTenantTemplate(tenantContextOf(principal)) }); }
  catch (error) { await recordOperationException(principal, '/api/settings/preview', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to preview template.' }, { status: 403 }); }
}
