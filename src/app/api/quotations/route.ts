import { recordOperationException } from '@/lib/operational-error';
import { NextResponse } from 'next/server';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type QuotationInput } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to view quotations.' }, { status: 401 });
  try { return NextResponse.json({ quotations: await getTenantStore().listQuotations(tenantContextOf(principal)) }); }
  catch (error) { await recordOperationException(principal, '/api/quotations', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Quotations could not be loaded.' }, { status: 403 }); }
}

export async function POST(request: Request) {
  const principal = await getPrincipal(request);
  if (!principal) return NextResponse.json({ message: 'Sign in to create quotations.' }, { status: 401 });
  try { return NextResponse.json({ quotation: await getTenantStore().createQuotation(tenantContextOf(principal), await request.json() as QuotationInput) }, { status: 201 }); }
  catch (error) { await recordOperationException(principal, '/api/quotations', error); return NextResponse.json({ message: error instanceof Error ? error.message : 'Quotation could not be created.' }, { status: 400 }); }
}
