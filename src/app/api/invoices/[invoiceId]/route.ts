import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type InvoiceInput } from '@/lib/tenant-store';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const invoice = await getTenantStore().getInvoice(session, (await context.params).invoiceId);
    return invoice ? NextResponse.json({ invoice }) : NextResponse.json({ message: 'Invoice not found.' }, { status: 404 });
  } catch (cause) { await recordOperationException(session, '/api/invoices/[invoiceId]', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to load invoice.' }, { status: 403 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json() as { status?: string; reason?: string; correction?: InvoiceInput };
    const invoiceId = (await context.params).invoiceId;
    if (body.correction) return NextResponse.json({ invoice: await getTenantStore().correctInvoice(session, invoiceId, body.correction, body.reason ?? '') });
    if (body.status === 'void') return NextResponse.json({ invoice: await getTenantStore().voidInvoice(session, invoiceId, body.reason ?? '') });
    return NextResponse.json({ message: 'Choose a void or correction action.' }, { status: 400 });
  } catch (cause) {
    await recordOperationException(session, '/api/invoices/[invoiceId]', cause);
    return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to void invoice.' }, { status: 400 });
  }
}
