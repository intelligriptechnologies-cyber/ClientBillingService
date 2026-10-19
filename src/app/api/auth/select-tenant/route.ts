import { NextResponse } from 'next/server';
import { cookieOptions, getPrincipal, tenantCookie } from '@/lib/auth/resolve';
import { recordOperationException } from '@/lib/operational-error';

/** Sets the selected tenant. A tenant the person has no active row in gets the same answer as one that does not exist. */
export async function POST(request: Request) {
  try {
    const principal = await getPrincipal(request);
    if (!principal) return NextResponse.json({ message: 'Sign in is required.' }, { status: 401 });
    const { tenantId } = await request.json().catch(() => ({})) as { tenantId?: unknown };
    const selectable = principal.kind === 'member' || principal.kind === 'chooseTenant' ? principal.tenantIds : [];
    if (typeof tenantId !== 'string' || !selectable.includes(tenantId)) return NextResponse.json({ message: 'Choose one of your tenants.' }, { status: 400 });
    const response = NextResponse.json({ tenantId });
    response.cookies.set(tenantCookie, tenantId, cookieOptions);
    return response;
  } catch (error) { await recordOperationException(null, '/api/auth/select-tenant', error); return NextResponse.json({ message: 'Unable to select the tenant.' }, { status: 400 }); }
}
