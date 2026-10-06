import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to view logs.' }, { status: 401 });
  try { return NextResponse.json({ logs: getTenantStore().listOperationalLogs(session) }); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to read logs.' }, { status: 403 }); }
}
