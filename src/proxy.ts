import { NextResponse, type NextRequest } from 'next/server';
import { readAuthConfig } from '@/lib/auth/config';
import { hasValidProxySecret, stripForwardedHeaders } from '@/lib/auth/forwarded';
import { checkOrigin } from '@/lib/auth/origin';

const refuse = (status: number, message: string) => NextResponse.json({ message }, { status });

export function proxy(request: NextRequest) {
  const result = readAuthConfig();
  if (!result.ok) return refuse(503, 'Authentication is not configured.');
  const { config } = result;
  const { pathname } = request.nextUrl;

  // The health check calls the app directly from the container and reads no tenant data.
  if (config.mode !== 'demo' && pathname !== '/api/health' && !hasValidProxySecret(request.headers, config.proxySecret)) return refuse(401, 'Unauthorized.');

  const origin = checkOrigin({
    method: request.method,
    pathname,
    protocol: request.nextUrl.protocol.replace(/:$/, ''),
    headers: request.headers,
    credentials: config.mode !== 'demo' ? 'proxy-headers' : 'cookie',
    publicOrigin: config.publicOrigin,
  });
  if (!origin.ok) return refuse(403, 'Cross-origin request refused.');

  // /api/v1/* takes bearer tokens only, so a forged identity must not reach its handlers.
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) return NextResponse.next({ request: { headers: stripForwardedHeaders(request.headers) } });
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
