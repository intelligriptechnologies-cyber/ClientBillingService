import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ deposits: getTenantStore().listSecurityDeposits(session) }); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load deposits.' }, { status: 400 }); }
}
