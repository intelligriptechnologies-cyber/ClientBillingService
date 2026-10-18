import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await getTenantStore().closeInvoice(session, (await params).invoiceId, String(body.note ?? '')));
  } catch (cause) { await recordOperationException(session, '/api/pending-payments/[invoiceId]/close', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to close invoice.' }, { status: 400 }); }
}
