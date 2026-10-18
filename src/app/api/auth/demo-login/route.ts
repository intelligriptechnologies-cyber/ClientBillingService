import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';
import { sessionCookie } from '@/lib/session';
import { notFoundUnlessDemo } from '@/lib/auth/demo-mode';
import { recordOperationException } from '@/lib/operational-error';

export async function POST(request: Request) {
  const unavailable = notFoundUnlessDemo();
  if (unavailable) return unavailable;
  try {
  const { userId } = await request.json() as { userId?: string };
  const session = userId ? await getTenantStore().authenticate(userId) : null;
  if (!session) return NextResponse.json({ message: 'Choose an active demo identity.' }, { status: 400 });
  const response = NextResponse.json({ session });
  response.cookies.set(sessionCookie, session.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
  } catch (error) { await recordOperationException(null, '/api/auth/demo-login', error); return NextResponse.json({ message: 'Unable to sign in.' }, { status: 400 }); }
}
