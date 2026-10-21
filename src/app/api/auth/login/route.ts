import { NextResponse } from 'next/server';
import { readAuthConfig } from '@/lib/auth/config';
import { hasValidProxySecret } from '@/lib/auth/forwarded';
import { loginSource, passwordLogin, sessionCookie, sessionSeconds } from '@/lib/auth/password';
import { cookieOptions } from '@/lib/auth/resolve';

export async function POST(request: Request) {
  const result = readAuthConfig();
  if (!result.ok || result.config.mode !== 'password') return NextResponse.json({ message: 'Not found.' }, { status: 404 });
  const config = result.config;
  if (!hasValidProxySecret(request.headers, config.proxySecret)) return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
  if (request.headers.get('origin') !== config.publicOrigin) return NextResponse.json({ message: 'Cross-origin request refused.' }, { status: 403 });
  try {
    // Bound the stream before parsing, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 4096) { await reader.cancel(); return NextResponse.json({ message: 'Request too large.' }, { status: 413 }); } chunks.push(part.value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body.username !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(body.username) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 1024) return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    const login = await passwordLogin(config.usersFile, body.username, body.password, loginSource(request.headers));
    if (login.status !== 200) return NextResponse.json({ message: login.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid credentials.' }, { status: login.status, headers: { 'Cache-Control': 'no-store', ...(login.status === 429 ? { 'Retry-After': '900' } : {}) } });
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(sessionCookie, login.token, { ...cookieOptions, maxAge: sessionSeconds });
    return response;
  } catch { return NextResponse.json({ message: 'Unable to sign in.' }, { status: 400 }); }
}
