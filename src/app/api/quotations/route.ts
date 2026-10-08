import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/session';
import { getTenantStore, type QuotationInput } from '@/lib/tenant-store';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to view quotations.' }, { status: 401 });
  try { return NextResponse.json({ quotations: getTenantStore().listQuotations(session) }); }
  catch (error) { recordOperationException(session, '/api/quotations', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Quotations could not be loaded.' }, { status: 403 }); }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ message: 'Sign in to create quotations.' }, { status: 401 });
  try { return NextResponse.json({ quotation: getTenantStore().createQuotation(session, await request.json() as QuotationInput) }, { status: 201 }); }
  catch (error) { recordOperationException(session, '/api/quotations', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Quotation could not be created.' }, { status: 400 }); }
}
