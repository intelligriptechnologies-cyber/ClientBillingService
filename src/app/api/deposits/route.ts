import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ deposits: await getTenantStore().listSecurityDeposits(tenantContextOf(session)) }); }
  catch (error) { await recordOperationException(session, '/api/deposits', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to load deposits.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json() as { depositId?: string; amountMinor?: number; note?: string };
    if (!body.depositId) return NextResponse.json({ message: 'Choose a security deposit.' }, { status: 400 });
    return NextResponse.json(await getTenantStore().settleSecurityDeposit(tenantContextOf(session), body.depositId, { amountMinor: Number(body.amountMinor), note: body.note ?? '' }));
  } catch (error) { await recordOperationException(session, '/api/deposits', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Unable to settle the security deposit.' }, { status: 400 }); }
}
