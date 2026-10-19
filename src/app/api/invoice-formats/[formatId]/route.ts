import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

type Context = { params: Promise<{ formatId: string }> };
function fail(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function PUT(request: Request, { params }: Context) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ format: await getTenantStore().updateInvoiceFormat(tenantContextOf(principal), (await params).formatId, await request.json()) }); }
  catch (cause) { await recordOperationException(principal, '/api/invoice-formats/[formatId]', cause); return fail(cause instanceof Error ? cause.message : 'Unable to save the invoice format.', 400); }
}

export async function DELETE(_: Request, { params }: Context) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return fail('A tenant session is required.', 401);
  try { await getTenantStore().deleteInvoiceFormat(tenantContextOf(principal), (await params).formatId); return NextResponse.json({ deleted: true }); }
  catch (cause) { await recordOperationException(principal, '/api/invoice-formats/[formatId]', cause); return fail(cause instanceof Error ? cause.message : 'Unable to delete the invoice format.', 400); }
}
