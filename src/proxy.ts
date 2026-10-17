import { NextResponse, type NextRequest } from 'next/server';
import { readAuthConfig } from '@/lib/auth/config';
import { checkOrigin } from '@/lib/auth/origin';

const refuse = (status: number, message: string) => NextResponse.json({ message }, { status });

export function proxy(request: NextRequest) {
  const result = readAuthConfig();
  if (!result.ok) return refuse(503, 'Authentication is not configured.');
  const { config } = result;

  const origin = checkOrigin({
    method: request.method,
    pathname: request.nextUrl.pathname,
    protocol: request.nextUrl.protocol.replace(/:$/, ''),
    headers: request.headers,
    credentials: config.mode === 'authelia' ? 'proxy-headers' : 'cookie',
    publicOrigin: config.publicOrigin,
  });
  if (!origin.ok) return refuse(403, 'Cross-origin request refused.');
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
