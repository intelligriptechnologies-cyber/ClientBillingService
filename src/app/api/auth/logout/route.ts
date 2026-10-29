import { revokePasswordSession, sessionCookie } from '@/lib/auth/password';
import { NextResponse } from 'next/server';
import { readAuthConfig } from '@/lib/auth/config';
import { cookieOptions, demoCookie, tenantCookie } from '@/lib/auth/resolve';
import { recordOperationException } from '@/lib/operational-error';

/** Clears the app's cookies. In authelia mode the client then visits the logout URL to end the Authelia session too (ADR 0002, decision 10). */
export async function POST(request?: Request) {
  if (request) revokePasswordSession(request.headers);
  try {
    const result = readAuthConfig();
    const response = NextResponse.json({ logoutUrl: result.ok && result.config.mode === 'authelia' ? result.config.logoutUrl : null });
    for (const name of [demoCookie, tenantCookie, sessionCookie]) response.cookies.set(name, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) { await recordOperationException(null, '/api/auth/logout', error); return NextResponse.json({ message: 'Unable to sign out.' }, { status: 500 }); }
}
