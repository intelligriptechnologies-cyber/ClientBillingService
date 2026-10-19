import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to view logs.' }, { status: 401 });
  try { return NextResponse.json({ logs: await getTenantStore().listOperationalLogs(tenantContextOf(principal)) }); }
  catch (error) { await recordOperationException(principal, '/api/logs', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to read logs.' }, { status: 403 }); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json() as { message?: string; stack?: string };
    const message = String(body.message ?? '').trim().slice(0, 4000);
    if (!message) return NextResponse.json({ message: 'An error message is required.' }, { status: 400 });
    await recordOperationException(principal, 'Client operation', new Error(`${message}\n${String(body.stack ?? '').slice(0, 8000)}`));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    await recordOperationException(principal, '/api/logs', error);
    return NextResponse.json({ message: 'Unable to record client error.' }, { status: 400 });
  }
}
