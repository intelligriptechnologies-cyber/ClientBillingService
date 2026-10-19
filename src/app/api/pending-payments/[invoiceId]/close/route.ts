import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function POST(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await getTenantStore().closeInvoice(tenantContextOf(principal), (await params).invoiceId, String(body.note ?? '')));
  } catch (cause) { await recordOperationException(principal, '/api/pending-payments/[invoiceId]/close', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to close invoice.' }, { status: 400 }); }
}
