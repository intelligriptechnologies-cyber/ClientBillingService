import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore } from '@/lib/tenant-store';

export async function POST(_: Request, { params }: { params: Promise<{ formatId: string }> }) {
  const session = await getCurrentSession();
  if (!session?.tenantId) return NextResponse.json({ message: 'A tenant session is required.' }, { status: 401 });
  try { return NextResponse.json({ format: getTenantStore().setDefaultInvoiceFormat(session, (await params).formatId) }); }
  catch (cause) { recordOperationException(session, '/api/invoice-formats/[formatId]/default', cause); return NextResponse.json({ message: cause instanceof Error ? cause.message : 'Unable to set the default invoice format.' }, { status: 400 }); }
}
