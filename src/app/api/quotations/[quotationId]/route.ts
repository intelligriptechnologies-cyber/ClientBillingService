import { recordOperationException } from '@/lib/operational-error';
import { getPrincipal } from '@/lib/auth/resolve';
import { getTenantStore, type QuotationInput, type Quotation } from '@/lib/tenant-store';
import { tenantContextOf } from '@/lib/auth/principal';

export async function PATCH(request: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  const principal = await getPrincipal(request);
  if (principal?.kind !== 'member') return Response.json({ message: 'A tenant session is required.' }, { status: 401 });
  try {
    const input = await request.json() as Partial<QuotationInput> & { status?: Quotation['status'] };
    const quotation = await getTenantStore().updateQuotation(tenantContextOf(principal), (await params).quotationId, input);
    return Response.json({ quotation });
  } catch (error) {
    await recordOperationException(principal, '/api/quotations/[quotationId]', error);
    return Response.json({ message: error instanceof Error ? error.message : 'Unable to update quotation.' }, { status: 400 });
  }
}
