import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

function period(request: Request) { return new URL(request.url).searchParams.get('period') ?? ''; }
function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return unauthorized();
  try { return NextResponse.json(await getTenantStore().previewBulkInvoices(tenantContextOf(principal), period(request))); }
  catch (cause) { await recordOperationException(principal, '/api/invoices/bulk', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to preview bulk invoices.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return unauthorized();
  try {
    const body = await request.json() as { billingPeriod?: string };
    return NextResponse.json(await getTenantStore().generateBulkInvoices(tenantContextOf(principal), body.billingPeriod ?? ''));
  } catch (cause) { await recordOperationException(principal, '/api/invoices/bulk', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to issue bulk invoices.' }, { status: 400 }); }
}
