import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type TenantUserInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/session-context';

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to manage tenant users.';
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  try {
    return NextResponse.json({ users: await getTenantStore().listTenantUsers(tenantContextOf(session)) });
  } catch (error) { await recordOperationException(session, '/api/users', error);
    return NextResponse.json({ message: messageFor(error) }, { status: 403 });
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to manage users.' }, { status: 401 });
  try {
    const input = await request.json() as TenantUserInput;
    const user = await getTenantStore().createTenantUser(tenantContextOf(session), input);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) { await recordOperationException(session, '/api/users', error);
    const message = messageFor(error);
    return NextResponse.json({ message }, { status: message.includes('admin') ? 403 : 400 });
  }
}
