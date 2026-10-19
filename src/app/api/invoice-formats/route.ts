import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function fail(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ formats: await getTenantStore().listInvoiceFormats(tenantContextOf(principal)) }); }
  catch (cause) { await recordOperationException(principal, '/api/invoice-formats', cause); return fail(cause instanceof Error ? cause.message : 'Unable to load invoice formats.', 400); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ format: await getTenantStore().createInvoiceFormat(tenantContextOf(principal), await request.json()) }, { status: 201 }); }
  catch (cause) { await recordOperationException(principal, '/api/invoice-formats', cause); return fail(cause instanceof Error ? cause.message : 'Unable to save the invoice format.', 400); }
}
