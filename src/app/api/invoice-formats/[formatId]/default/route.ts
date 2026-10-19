import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function POST(_: Request, { params }: { params: Promise<{ formatId: string }> }) {
  const principal = await getPrincipal(_);
  if (principal?.kind !== 'member') return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ format: await getTenantStore().setDefaultInvoiceFormat(tenantContextOf(principal), (await params).formatId) }); }
  catch (cause) { await recordOperationException(principal, '/api/invoice-formats/[formatId]/default', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to set the default invoice format.' }, { status: 400 }); }
}
