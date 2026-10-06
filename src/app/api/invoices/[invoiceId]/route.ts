import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function GET(_: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const invoice = getTenantStore().getInvoice(session, (await context.params).invoiceId);
    return invoice ? NextResponse.json({ invoice }) : NextResponse.json({ message: 'Invoice not found.' }, { status: 404 });
  } catch (cause) { return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to load invoice.' }, { status: 403 }); }
}
