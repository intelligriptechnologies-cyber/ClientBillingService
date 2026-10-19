import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type TenantUserInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to manage tenant users.';
}

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  try {
    return NextResponse.json({ users: await getTenantStore().listTenantUsers(tenantContextOf(principal)) });
  } catch (error) { await recordOperationException(principal, '/api/users', error);
    return NextResponse.json({ message: messageFor(error) }, { status: 403 });
  }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  try {
    const input = await request.json() as TenantUserInput;
    const user = await getTenantStore().createTenantUser(tenantContextOf(principal), input);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) { await recordOperationException(principal, '/api/users', error);
    const message = messageFor(error);
    return NextResponse.json({ message }, { status: message.includes('admin') ? 403 : 400 });
  }
}
