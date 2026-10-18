import { NextResponse } from 'next/server';
import { getInvoiceEmailDefaults, MailServiceError } from '@/lib/mail-service';
import { recordOperationException } from '@/lib/operational-error';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const store = getTenantStore(); const { invoiceId } = await context.params;
    const defaults = await getInvoiceEmailDefaults(store, session, invoiceId);
    return NextResponse.json({ deliveries: await store.listDeliveries(session, invoiceId), defaults });
  } catch (cause) {
    if (cause instanceof MailServiceError) return NextResponse.json({ message: cause.message }, { status: cause.status });
    await recordOperationException(session, '/api/invoices/[invoiceId]/deliveries', cause);
    return NextResponse.json({ message: 'Unable to load deliveries.' }, { status: 400 });
  }
}
