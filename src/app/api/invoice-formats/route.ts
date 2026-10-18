import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

function fail(message: string, status: number) { return NextResponse.json({ message }, { status }); }

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.tenantId) return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ formats: await getTenantStore().listInvoiceFormats(session) }); }
  catch (cause) { await recordOperationException(session, '/api/invoice-formats', cause); return fail(cause instanceof Error ? cause.message : 'Unable to load invoice formats.', 400); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return fail('A tenant session is required.', 401);
  try { return NextResponse.json({ format: await getTenantStore().createInvoiceFormat(session, await request.json()) }, { status: 201 }); }
  catch (cause) { await recordOperationException(session, '/api/invoice-formats', cause); return fail(cause instanceof Error ? cause.message : 'Unable to save the invoice format.', 400); }
}
