import { NextResponse } from 'next/server';
import { getTenantStore } from '@/lib/tenant-store';
import { sessionCookie } from '@/lib/session';

export async function POST(request: Request) {
  const { userId } = await request.json() as { userId?: string };
  const session = userId ? getTenantStore().authenticate(userId) : null;
  if (!session) return NextResponse.json({ message: 'Choose an active demo identity.' }, { status: 400 });
  const response = NextResponse.json({ session });
  response.cookies.set(sessionCookie, session.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
