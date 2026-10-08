import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to view logs.' }, { status: 401 });
  try { return NextResponse.json({ logs: getTenantStore().listOperationalLogs(session) }); }
  catch (error) { recordOperationException(session, '/api/logs', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to read logs.' }, { status: 403 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json() as { message?: string; stack?: string };
    const message = String(body.message ?? '').trim().slice(0, 4000);
    if (!message) return NextResponse.json({ message: 'An error message is required.' }, { status: 400 });
    recordOperationException(session, 'Client operation', new Error(`${message}\n${String(body.stack ?? '').slice(0, 8000)}`));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    recordOperationException(session, '/api/logs', error);
    return NextResponse.json({ message: 'Unable to record client error.' }, { status: 400 });
  }
}
