import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

type Context = { params: Promise<{ formatId: string }> };
function fail(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function PUT(request: Request, { params }: Context) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ format: await getTenantStore().updateInvoiceFormat(session, (await params).formatId, await request.json()) }); }
  catch (cause) { await recordOperationException(session, '/api/invoice-formats/[formatId]', cause); return fail(cause instanceof Error ? cause.message : 'Unable to save the invoice format.', 400); }
}

export async function DELETE(_: Request, { params }: Context) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return fail('A tenant session is required.', 401);
  try { await getTenantStore().deleteInvoiceFormat(session, (await params).formatId); return NextResponse.json({ deleted: true }); }
  catch (cause) { await recordOperationException(session, '/api/invoice-formats/[formatId]', cause); return fail(cause instanceof Error ? cause.message : 'Unable to delete the invoice format.', 400); }
}
