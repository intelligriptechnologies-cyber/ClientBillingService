import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type InvoiceInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const invoice = await getTenantStore().getInvoice(tenantContextOf(principal), (await context.params).invoiceId);
    return invoice ? NextResponse.json({ invoice }) : NextResponse.json({ message: 'Invoice not found.' }, { status: 404 });
  } catch (cause) { await recordOperationException(principal, '/api/invoices/[invoiceId]', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to load invoice.' }, { status: 403 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json() as { status?: string; reason?: string; correction?: InvoiceInput };
    const invoiceId = (await context.params).invoiceId;
    if (body.correction) return NextResponse.json({ invoice: await getTenantStore().correctInvoice(tenantContextOf(principal), invoiceId, body.correction, body.reason ?? '') });
    if (body.status === 'void') return NextResponse.json({ invoice: await getTenantStore().voidInvoice(tenantContextOf(principal), invoiceId, body.reason ?? '') });
    return NextResponse.json({ message: 'Choose a void or correction action.' }, { status: 400 });
  } catch (cause) {
    await recordOperationException(principal, '/api/invoices/[invoiceId]', cause);
    return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to void invoice.' }, { status: 400 });
  }
}
