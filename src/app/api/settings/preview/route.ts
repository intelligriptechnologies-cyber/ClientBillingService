import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function POST() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to preview templates.' }, { status: 401 });
  try { return NextResponse.json({ preview: getTenantStore().previewTenantTemplate(session) }); }
  catch (error) { recordOperationException(session, '/api/settings/preview', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to preview template.' }, { status: 403 }); }
}
