import { NextResponse } from 'next/server';
import { getInvoiceEmailDefaults, MailServiceError } from '@/lib/mail-service';
import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const store = getTenantStore(); const { invoiceId } = await context.params;
    const defaults = await getInvoiceEmailDefaults(store, principal, invoiceId);
    return NextResponse.json({ deliveries: await store.listDeliveries(tenantContextOf(principal), invoiceId), defaults });
  } catch (cause) {
    if (cause instanceof MailServiceError) return NextResponse.json({ message: cause.message }, { status: cause.status });
    await recordOperationException(principal, '/api/invoices/[invoiceId]/deliveries', cause);
    return NextResponse.json({ message: 'Unable to load deliveries.' }, { status: 400 });
  }
}
