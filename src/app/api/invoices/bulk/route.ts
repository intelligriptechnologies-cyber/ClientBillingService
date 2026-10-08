import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

function period(request: Request) { return new URL(request.url).searchParams.get('period') ?? ''; }
function unauthorized() { return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 }); }

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try { return NextResponse.json(getTenantStore().previewBulkInvoices(session, period(request))); }
  catch (cause) { recordOperationException(session, '/api/invoices/bulk', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to preview bulk invoices.' }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return unauthorized();
  try {
    const body = await request.json() as { billingPeriod?: string };
    return NextResponse.json(getTenantStore().generateBulkInvoices(session, body.billingPeriod ?? ''));
  } catch (cause) { recordOperationException(session, '/api/invoices/bulk', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to issue bulk invoices.' }, { status: 400 }); }
}
