import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type ServiceInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function messageFor(error: unknown) { return error instanceof Error ? error.message : 'Services could not be managed.'; }

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to view services.' }, { status: 401 });
  try { return NextResponse.json({ services: await getTenantStore().listServices(tenantContextOf(principal), new URL(request.url).searchParams.get('search') ?? '') }); }
  catch (error) { await recordOperationException(principal, '/api/services', error); return NextResponse.json({ message: messageFor(error) }, { status: 403 }); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage services.' }, { status: 401 });
  try { return NextResponse.json({ service: await getTenantStore().createService(tenantContextOf(principal), await request.json() as ServiceInput) }, { status: 201 }); }
  catch (error) { await recordOperationException(principal, '/api/services', error); return NextResponse.json({ message: messageFor(error) }, { status: 400 }); }
}
