import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';
import { listDemoIdentities } from '@/lib/auth/demo-identities';
import { notFoundUnlessDemo } from '@/lib/auth/demo-mode';
import { cookieOptions, demoCookie, demoPlatform, tenantCookie } from '@/lib/auth/resolve';
import { recordOperationException } from '@/lib/operational-error';

export async function POST(request: Request) {
  const unavailable = notFoundUnlessDemo();
  if (unavailable) return unavailable;
  try {
    const { userId } = await request.json() as { userId?: string };
    const identity = userId ? (await listDemoIdentities(getTenantStore())).find((candidate) => candidate.id === userId) : undefined;
    if (!identity) return NextResponse.json({ message: 'Choose an active demo identity.' }, { status: 400 });
    const response = NextResponse.json({ identity });
    if (identity.tenantId === null) response.cookies.set(demoCookie, demoPlatform, cookieOptions);
    else {
      response.cookies.set(demoCookie, identity.id, cookieOptions);
      response.cookies.set(tenantCookie, identity.tenantId, cookieOptions);
    }
    return response;
  } catch (error) { await recordOperationException(null, '/api/auth/demo-login', error); return NextResponse.json({ message: 'Unable to sign in.' }, { status: 400 }); }
}
