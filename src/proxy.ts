import { NextResponse, type NextRequest } from 'next/server';

// Legacy prototype routes read a single shared in-memory store. Keep them unreachable
// until their tenant-scoped replacements land in the corresponding implementation slices.
const legacyRoutes = new Set(['/clients', '/reports/outstanding', '/settings']);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (legacyRoutes.has(pathname) || [...legacyRoutes].some((route) => pathname.startsWith(`${route}/`))) return NextResponse.redirect(new URL('/dashboard', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
